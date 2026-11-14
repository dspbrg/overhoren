// Foto-teller als Durable Object (SQLite-opslag, werkt op het gratis plan).
// Er is een instantie voor de hele app. Reserveren en terugboeken lopen
// volledig synchroon op ctx.storage.kv, zonder await ertussen: zo kan geen
// ander verzoek tussen lezen en schrijven komen en gaat er nooit iets over
// de grens.
//
// Per soort (extract, enrich) een rij:
//   { dag, toestellen: { <id>: aantal }, maand, maandStand, gemeld: [drempels],
//     teMelden: [{ maand, drempel }], laatstePoging: ms }
// De eerste reservering op een nieuwe dag maakt de toestellen leeg, die in
// een nieuwe maand de maandstand en de gemelde drempels. Een toestel dat door
// terugboeken op 0 komt, gaat uit de lijst.
//
// gemeld: drempels die deze maand gehaald zijn (komen maar een keer terug).
// teMelden: gehaalde drempels die hq nog niet bevestigd heeft (hooguit 4).
// Een reservering voor /extract geeft ze terug (ook een geweigerde), hooguit
// eens per MELD_PAUZE_MS (laatstePoging), tot de worker na een 200 of 201
// van hq /gemeld aanroept. Ze blijven over de maandgrens staan, zodat een
// melding op de laatste dag niet verloren gaat.
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
// Bij deze maandstanden van /extract gaat een melding naar het dashboard hq.
// De drempel wordt een keer gehaald (de reservering die hem haalt) en blijft
// in teMelden tot hq hem bevestigt.
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
// Hooguit zoveel openstaande meldingen bewaren (de nieuwste).
export const TE_MELDEN_MAX = 4;
// Open meldingen hooguit eens per zoveel ms opnieuw proberen (5 minuten).
export const MELD_PAUZE_MS = 5 * 60 * 1000;
// hq draait alleen hier; een andere host krijgt het token nooit.
export const MELD_HOST = "hq.vandaan.net";
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

// Melding naar het dashboard hq bij 80 en 100 foto's in een maand. Staat
// hier en niet in index.js: een losse functie-export daar ziet workerd als
// ingang. Geeft true als hq hem heeft (201 nieuw of 200 al bekend), anders
// false. Gooit nooit. Zonder HQ_MELD_URL en HQ_MELD_TOKEN: niets, geen net.
// De URL moet https://hq.vandaan.net/api/melding zijn (MELD_HOST, geen poort,
// precies dit pad). Het token gaat
// nooit achter een redirect aan (redirect: "manual", een 3xx is een fout) en
// komt nooit in de logs: alleen de status of een korte reden.
export const MELD_TIMEOUT_MS = 5000;
const MAAND_VORM = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function meldDrempel(env, maand, drempel) {
  const adres = env && env.HQ_MELD_URL;
  const token = env && env.HQ_MELD_TOKEN;
  if (!adres || !token || typeof adres !== "string" || typeof token !== "string") return false;
  if (!MAAND_VORM.test(String(maand)) || !MELD_DREMPELS.includes(drempel)) return false;
  let url = null;
  try { url = new URL(adres); } catch (e) { url = null; }
  if (!url || url.protocol !== "https:" || url.hostname !== MELD_HOST || url.port ||
      url.pathname !== "/api/melding" || url.search || url.hash || url.username || url.password) {
    console.error("Melding hq: HQ_MELD_URL ongeldig");
    return false;
  }
  try {
    const res = await fetch(url.href, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(MELD_TIMEOUT_MS),
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ bron: "overhoren", soort: "foto-" + drempel, maand }),
    });
    if (res.body) await res.body.cancel().catch(() => {});
    if (res.status === 200 || res.status === 201) return true;
    console.error("Melding hq: status " + res.status);
    return false;
  } catch (e) {
    console.error("Melding hq: " + (e && e.name === "TimeoutError" ? "time-out" : "netwerkfout"));
    return false;
  }
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
    const teMelden = Array.isArray(s.teMelden)
      ? s.teMelden.filter((m) => m && MAAND_VORM.test(m.maand) && MELD_DREMPELS.includes(m.drempel))
      : [];
    const laatstePoging = Number.isFinite(s.laatstePoging) ? s.laatstePoging : 0;
    return { dag, toestellen, maand, maandStand, gemeld, teMelden, laatstePoging };
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
    // Ook bij een volle grens de openstaande meldingen: na 100 slaagt er voor
    // bijna niemand nog een reservering, en dan bleef een mislukte 100 liggen.
    const vol = o ? (o.per[onbeperkt] || 0) >= ONBEPERKT_PER_MAAND : s.maandStand >= FOTO_PER_MAAND;
    if (vol || eigen >= FOTO_PER_TOESTEL_PER_DAG) {
      const open = this.teMeldenNu(s, false);
      if (open.length) this.kv.put("stand:" + soort, s); // laatstePoging bewaren
      return { ok: false, grens: vol ? "maand" : "toestel", teMelden: open };
    }
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
    const alle = s.teMelden.concat(drempels.map((drempel) => ({ maand, drempel })));
    if (alle.length > TE_MELDEN_MAX) console.error("Melding hq: oudste open melding vervallen");
    s.teMelden = alle.slice(-TE_MELDEN_MAX);
    const open = this.teMeldenNu(s, drempels.length > 0);
    this.kv.put("stand:" + soort, s);
    return { ok: true, dag, maand, drempels, teMelden: open };
  }

  // De open meldingen die deze reservering mag proberen. Een net gehaalde
  // drempel gaat meteen (hooguit twee keer per maand); verder hooguit eens
  // per MELD_PAUZE_MS, zodat een storing bij hq niet elke foto een aanroep
  // kost. Zet laatstePoging; de aanroeper bewaart de rij.
  teMeldenNu(s, nieuw) {
    if (!s.teMelden.length) return [];
    const nu = Date.now();
    const wacht = nu >= s.laatstePoging && nu - s.laatstePoging < MELD_PAUZE_MS;
    if (!nieuw && wacht) return [];
    s.laatstePoging = nu;
    return s.teMelden;
  }

  // hq heeft de melding (200 of 201): niet meer opnieuw proberen.
  afgeleverd(maand, drempel) {
    const s = this.kv.get("stand:extract");
    if (!s || !Array.isArray(s.teMelden)) return;
    const rest = s.teMelden.filter((m) => !(m && m.maand === maand && m.drempel === drempel));
    if (rest.length === s.teMelden.length) return;
    s.teMelden = rest;
    this.kv.put("stand:extract", s);
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
    if (pad === "/gemeld") {
      if (!v || typeof v.maand !== "string" || !MAAND_VORM.test(v.maand) || !MELD_DREMPELS.includes(v.drempel)) return antwoord({ error: "Ongeldig" }, 400);
      this.afgeleverd(v.maand, v.drempel);
      return antwoord({ ok: true });
    }
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
