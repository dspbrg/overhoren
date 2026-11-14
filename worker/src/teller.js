// Foto-teller als Durable Object (SQLite-opslag, werkt op het gratis plan).
// Er is een instantie voor de hele app. Reserveren en terugboeken lopen
// volledig synchroon op ctx.storage.kv, zonder await ertussen: zo kan geen
// ander verzoek tussen lezen en schrijven komen en gaat er nooit iets over
// de grens.
//
// Per soort (extract, enrich) een rij:
//   { dag, toestellen: { <id>: aantal }, maand, maandStand, gemeld: [drempels] }
// De eerste reservering op een nieuwe dag maakt de toestellen leeg, die in
// een nieuwe maand de maandstand en de gemelde drempels. Een toestel dat door
// terugboeken op 0 komt, gaat uit de lijst.
//
// Dezelfde klasse bewaart ook de codes van de overstap van het oude
// wachtwoord naar een code per persoon (/migreer), in een eigen instantie
// ("migratie"). Een Durable Object en geen KV: KV kan op een andere plek
// tot een minuut achterlopen, en dan zou een tweede toestel van dezelfde
// persoon een andere code krijgen. Hier is het een stap zonder await:
// bestaat migratie:<slug>, dan die code, anders een nieuwe.

import { maakCode, geldigeCode } from "./code.js";

export const FOTO_PER_TOESTEL_PER_DAG = 10;
export const FOTO_PER_MAAND = 100;
// Bij deze maandstanden van /extract komt later een melding naar het
// dashboard. Precies een keer: alleen de reservering die de drempel haalt.
export const MELD_DREMPELS = [80, 100];
// Een code in ONBEPERKT telt niet tegen FOTO_PER_MAAND, maar heeft per
// hash een eigen harde grens per kalendermaand (per soort).
export const ONBEPERKT_PER_MAAND = 300;
// Hooguit zoveel nieuwe persoon:-records per kalenderdag, voor iedereen
// samen. Remt het volschrijven van KV met zelfgemaakte codes.
export const NIEUW_PER_DAG = 30;
// en hooguit zoveel per tempo-sleutel (IPv4-adres of IPv6-/64) per dag
export const NIEUW_PER_IP_PER_DAG = 5;
const SOORTEN = ["extract", "enrich"];
const HASH_VORM = /^[0-9a-f]{64}$/;
// Slug van een naam, zoals de app hem maakt (slug() in index.html).
export const SLUG_VORM = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MAX = 64;

// Kalenderdag in Europe/Amsterdam, als 2026-11-14.
export function dagVan(ms) {
  const delen = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ms));
  const w = (t) => delen.find((d) => d.type === t).value;
  return `${w("year")}-${w("month")}-${w("day")}`;
}

// Haak voor de melding naar het dashboard bij 80 en 100 foto's in een maand.
// Nog niet gebouwd: doet niets en gaat niet het net op. Staat hier en niet
// in index.js: een losse functie-export daar ziet workerd als ingang.
export async function meldDrempel(env, maand, drempel) {
  return false;
}

function antwoord(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

export class FotoTeller {
  constructor(state) {
    this.kv = state.storage.kv;
  }

  stand(soort, dag, maand) {
    const s = this.kv.get("stand:" + soort) || {};
    const toestellen = s.dag === dag && s.toestellen ? s.toestellen : {};
    const zelfdeMaand = s.maand === maand;
    const maandStand = zelfdeMaand && Number.isFinite(s.maandStand) ? s.maandStand : 0;
    const gemeld = zelfdeMaand && Array.isArray(s.gemeld) ? s.gemeld : [];
    return { dag, toestellen, maand, maandStand, gemeld };
  }

  // Tellers per ONBEPERKT-hash, apart van de stand: { maand, per: { hash: n } }.
  onbeperkt(soort, maand) {
    const o = this.kv.get("onbeperkt:" + soort) || {};
    return { maand, per: o.maand === maand && o.per ? o.per : {} };
  }

  // Een plek voor toestel en maand, of de grens die vol is. onbeperkt: de
  // sha256 van een code in ONBEPERKT (of null). Dan geldt FOTO_PER_MAAND
  // niet, wel ONBEPERKT_PER_MAAND voor die hash, en telt de reservering mee
  // voor de stand en de drempels.
  reserveer(soort, toestel, onbeperkt = null) {
    const dag = dagVan(Date.now());
    const maand = dag.slice(0, 7);
    const s = this.stand(soort, dag, maand);
    const eigen = s.toestellen[toestel] || 0;
    const o = onbeperkt ? this.onbeperkt(soort, maand) : null;
    if (o && (o.per[onbeperkt] || 0) >= ONBEPERKT_PER_MAAND) return { ok: false, grens: "maand" };
    if (!o && s.maandStand >= FOTO_PER_MAAND) return { ok: false, grens: "maand" };
    if (eigen >= FOTO_PER_TOESTEL_PER_DAG) return { ok: false, grens: "toestel" };
    if (o) {
      o.per[onbeperkt] = (o.per[onbeperkt] || 0) + 1;
      this.kv.put("onbeperkt:" + soort, o);
    }
    const voor = s.maandStand;
    s.toestellen[toestel] = eigen + 1;
    s.maandStand = voor + 1;
    // Een drempel wordt een keer per maand gemeld, ook als de stand na een
    // terugboeking opnieuw over de drempel gaat.
    const drempels = soort === "extract"
      ? MELD_DREMPELS.filter((d) => voor < d && d <= s.maandStand && !s.gemeld.includes(d))
      : [];
    s.gemeld = s.gemeld.concat(drempels);
    this.kv.put("stand:" + soort, s);
    return { ok: true, dag, maand, drempels };
  }

  // Alleen bij een storing aan de kant van Anthropic. Een reservering
  // van een vorige dag of maand blijft staan.
  terugboeken(soort, toestel, dag, maand, onbeperkt = null) {
    if (onbeperkt) {
      const o = this.kv.get("onbeperkt:" + soort);
      if (o && o.maand === maand && o.per && o.per[onbeperkt] > 0) {
        o.per[onbeperkt]--;
        this.kv.put("onbeperkt:" + soort, o);
      }
    }
    const s = this.kv.get("stand:" + soort);
    if (!s) return;
    if (s.dag === dag && s.toestellen && s.toestellen[toestel] > 0) {
      s.toestellen[toestel]--;
      if (s.toestellen[toestel] === 0) delete s.toestellen[toestel];
    }
    if (s.maand === maand && s.maandStand > 0) s.maandStand--;
    this.kv.put("stand:" + soort, s);
  }

  // De code voor deze slug: de bestaande, of een nieuwe die meteen bewaard
  // wordt. Synchroon, dus twee toestellen tegelijk krijgen dezelfde.
  migreer(slug) {
    const k = "migratie:" + slug;
    const oud = this.kv.get(k);
    if (geldigeCode(oud)) return { code: oud, nieuw: false };
    const code = maakCode();
    this.kv.put(k, code);
    // index, zodat wisMigratie alles kan vinden zonder list()
    const alle = this.kv.get("migratie-index") || [];
    if (!alle.includes(slug)) this.kv.put("migratie-index", alle.concat([slug]));
    return { code, nieuw: true };
  }

  // Na het weghalen van APP_SECRET: alle codes van de overstap weg.
  wisMigratie() {
    const alle = this.kv.get("migratie-index") || [];
    for (const slug of alle) this.kv.delete("migratie:" + slug);
    this.kv.delete("migratie-index");
    return { gewist: alle.length };
  }

  // Mag er vandaag nog een nieuw persoon:-record bij, in totaal en voor deze
  // tempo-sleutel (IP of IPv6-/64)? Telt meteen. Een nieuwe dag begint leeg.
  nieuwRecord(sleutel) {
    const dag = dagVan(Date.now());
    const n = this.kv.get("nieuw") || {};
    const zelfdeDag = n.dag === dag;
    const aantal = zelfdeDag && Number.isFinite(n.aantal) ? n.aantal : 0;
    const per = zelfdeDag && n.per && typeof n.per === "object" ? n.per : {};
    if (aantal >= NIEUW_PER_DAG) return { ok: false };
    if ((per[sleutel] || 0) >= NIEUW_PER_IP_PER_DAG) return { ok: false };
    per[sleutel] = (per[sleutel] || 0) + 1;
    this.kv.put("nieuw", { dag, aantal: aantal + 1, per });
    return { ok: true };
  }

  async fetch(request) {
    let v;
    try { v = await request.json(); } catch (e) { return antwoord({ error: "Ongeldig" }, 400); }
    // vanaf hier synchroon tot het antwoord
    const pad = new URL(request.url).pathname;
    if (pad === "/migreer") {
      if (!v || typeof v.slug !== "string" || v.slug.length > SLUG_MAX || !SLUG_VORM.test(v.slug)) return antwoord({ error: "Ongeldig" }, 400);
      return antwoord(this.migreer(v.slug));
    }
    if (pad === "/wis-migratie") return antwoord(this.wisMigratie());
    if (pad === "/nieuw") {
      if (!v || typeof v.sleutel !== "string" || !v.sleutel || v.sleutel.length > 64) return antwoord({ error: "Ongeldig" }, 400);
      return antwoord(this.nieuwRecord(v.sleutel));
    }
    if (!v || !SOORTEN.includes(v.soort) || typeof v.toestel !== "string" || v.toestel.length > 36) {
      return antwoord({ error: "Ongeldig" }, 400);
    }
    const onbeperkt = typeof v.onbeperkt === "string" && HASH_VORM.test(v.onbeperkt) ? v.onbeperkt : null;
    if (pad === "/reserveer") return antwoord(this.reserveer(v.soort, v.toestel, onbeperkt));
    if (pad === "/terugboeken") {
      this.terugboeken(v.soort, v.toestel, String(v.dag), String(v.maand), onbeperkt);
      return antwoord({ ok: true });
    }
    return antwoord({ error: "Niet gevonden" }, 404);
  }
}
