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

export const FOTO_PER_TOESTEL_PER_DAG = 10;
export const FOTO_PER_MAAND = 100;
// Bij deze maandstanden van /extract komt later een melding naar het
// dashboard. Precies een keer: alleen de reservering die de drempel haalt.
export const MELD_DREMPELS = [80, 100];
const SOORTEN = ["extract", "enrich"];

// Kalenderdag in Europe/Amsterdam, als 2026-11-14.
export function dagVan(ms) {
  const delen = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ms));
  const w = (t) => delen.find((d) => d.type === t).value;
  return `${w("year")}-${w("month")}-${w("day")}`;
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

  // Een plek voor toestel en maand, of de grens die vol is.
  reserveer(soort, toestel) {
    const dag = dagVan(Date.now());
    const maand = dag.slice(0, 7);
    const s = this.stand(soort, dag, maand);
    const eigen = s.toestellen[toestel] || 0;
    if (s.maandStand >= FOTO_PER_MAAND) return { ok: false, grens: "maand" };
    if (eigen >= FOTO_PER_TOESTEL_PER_DAG) return { ok: false, grens: "toestel" };
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
  terugboeken(soort, toestel, dag, maand) {
    const s = this.kv.get("stand:" + soort);
    if (!s) return;
    if (s.dag === dag && s.toestellen && s.toestellen[toestel] > 0) {
      s.toestellen[toestel]--;
      if (s.toestellen[toestel] === 0) delete s.toestellen[toestel];
    }
    if (s.maand === maand && s.maandStand > 0) s.maandStand--;
    this.kv.put("stand:" + soort, s);
  }

  async fetch(request) {
    let v;
    try { v = await request.json(); } catch (e) { return antwoord({ error: "Ongeldig" }, 400); }
    // vanaf hier synchroon tot het antwoord
    if (!v || !SOORTEN.includes(v.soort) || typeof v.toestel !== "string" || v.toestel.length > 36) {
      return antwoord({ error: "Ongeldig" }, 400);
    }
    const pad = new URL(request.url).pathname;
    if (pad === "/reserveer") return antwoord(this.reserveer(v.soort, v.toestel));
    if (pad === "/terugboeken") {
      this.terugboeken(v.soort, v.toestel, String(v.dag), String(v.maand));
      return antwoord({ ok: true });
    }
    return antwoord({ error: "Niet gevonden" }, 404);
  }
}

// Haak voor de melding naar het dashboard bij 80 en 100 foto's in een maand.
// Nog niet gebouwd: doet niets en gaat niet het net op.
export async function meldDrempel(env, maand, drempel) {
  return false;
}
