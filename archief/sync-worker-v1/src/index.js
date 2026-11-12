// =============================================================
// Overhoren sync-api
//
// Bewaart de voortgang per oefenaar en per woordenlijst, zodat ze op een
// ander apparaat verder kan. Meer niet.
//
// Ontwerpuitgangspunten, omdat hier gegevens van kinderen in staan:
//   - een zelfgekozen bijnaam, geen echte naam nodig
//   - geen e-mail, geen wachtwoord; een gegenereerde code volstaat
//   - alleen leerstatus per woord en rondesamenvattingen, geen vrije tekst
//   - alles is te wissen met een enkele aanroep
//   - de code wordt gehasht opgeslagen, dus staat nergens leesbaar
//
// Endpoints
//   POST   /v1/account                 {naam}            -> {naam, code}
//   GET    /v1/progress/:naam/:lijst   X-Code            -> voortgang
//   PUT    /v1/progress/:naam/:lijst   X-Code + body     -> opslaan
//   DELETE /v1/account/:naam           X-Code            -> alles wissen
// =============================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Code",
  "Access-Control-Max-Age": "86400"
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", ...CORS }
  });

// Een code van zes tekens uit een alfabet zonder verwarrende letters
// (geen O/0, geen I/1). Genereren in plaats van laten kiezen, want een
// zelfgekozen code wordt "1234".
const ALFABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function maakCode() {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return Array.from(b, x => ALFABET[x % ALFABET.length]).join("");
}

async function hash(code, zout) {
  const data = new TextEncoder().encode(zout + ":" + code.toUpperCase());
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}

const slug = s => String(s || "").toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);

// Een code van zes tekens uit dit alfabet is 32^6, ruim een miljard
// mogelijkheden. Met deze rem is raden geen begaanbare weg meer.
const POGINGEN_MAX = 10, POGINGEN_VENSTER = 3600;
async function remCheck(env, naam) {
  const sleutel = "rl:" + naam;
  const n = parseInt(await env.OVERHOREN.get(sleutel) || "0", 10);
  if (n >= POGINGEN_MAX) return false;
  await env.OVERHOREN.put(sleutel, String(n + 1), { expirationTtl: POGINGEN_VENSTER });
  return true;
}

async function checkCode(env, naam, code) {
  if (!code) return { ok: false, status: 401, fout: "code ontbreekt" };
  if (!await remCheck(env, naam)) return { ok: false, status: 429, fout: "te veel pogingen, probeer het over een uur" };
  const ruw = await env.OVERHOREN.get("u:" + naam);
  if (!ruw) return { ok: false, status: 404, fout: "onbekende naam" };
  const account = JSON.parse(ruw);
  const goed = await hash(code, env.ZOUT || "overhoren");
  if (goed !== account.codeHash) return { ok: false, status: 401, fout: "code klopt niet" };
  return { ok: true, account };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const delen = url.pathname.split("/").filter(Boolean);   // ["v1","progress",naam,lijst]
    const code = request.headers.get("X-Code") || "";

    try {
      // --- account aanmaken ---
      if (request.method === "POST" && delen[0] === "v1" && delen[1] === "account") {
        const body = await request.json().catch(() => ({}));
        const naam = slug(body.naam);
        if (!naam) return json({ fout: "naam ontbreekt" }, 400);
        if (await env.OVERHOREN.get("u:" + naam)) return json({ fout: "die naam is al in gebruik" }, 409);
        const nieuw = maakCode();
        await env.OVERHOREN.put("u:" + naam, JSON.stringify({
          codeHash: await hash(nieuw, env.ZOUT || "overhoren"),
          gemaakt: Date.now()
        }));
        return json({ naam, code: nieuw }, 201);
      }

      // --- voortgang ophalen of opslaan ---
      if (delen[0] === "v1" && delen[1] === "progress" && delen[2] && delen[3]) {
        const naam = slug(delen[2]), lijst = slug(delen[3]);
        const check = await checkCode(env, naam, code);
        if (!check.ok) return json({ fout: check.fout }, check.status);
        const sleutel = "p:" + naam + ":" + lijst;

        if (request.method === "GET") {
          const ruw = await env.OVERHOREN.get(sleutel);
          return ruw ? json(JSON.parse(ruw)) : json({ leeg: true }, 404);
        }
        if (request.method === "PUT") {
          const body = await request.json().catch(() => null);
          if (!body || typeof body !== "object") return json({ fout: "ongeldige inhoud" }, 400);
          // Alleen bewaren wat de app nodig heeft. Wat er verder in de body
          // zit gaat niet mee, zodat er nooit onbedoeld iets belandt.
          const schoon = {
            items: body.items && typeof body.items === "object" ? body.items : {},
            sessions: Array.isArray(body.sessions) ? body.sessions.slice(-60) : [],
            updated: Number(body.updated) || Date.now()
          };
          const bestaand = await env.OVERHOREN.get(sleutel);
          if (bestaand) {
            // nieuwste wint, dezelfde regel als de app zelf hanteert
            const oud = JSON.parse(bestaand);
            if ((oud.updated || 0) > schoon.updated) return json({ ok: true, ouder: true, server: oud });
          }
          await env.OVERHOREN.put(sleutel, JSON.stringify(schoon));
          return json({ ok: true, updated: schoon.updated });
        }
      }

      // --- alles van een oefenaar wissen ---
      if (request.method === "DELETE" && delen[0] === "v1" && delen[1] === "account" && delen[2]) {
        const naam = slug(delen[2]);
        const check = await checkCode(env, naam, code);
        if (!check.ok) return json({ fout: check.fout }, check.status);
        const lijst = await env.OVERHOREN.list({ prefix: "p:" + naam + ":" });
        await Promise.all(lijst.keys.map(k => env.OVERHOREN.delete(k.name)));
        await env.OVERHOREN.delete("u:" + naam);
        return json({ ok: true, gewist: lijst.keys.length + 1 });
      }

      return json({ fout: "onbekend pad" }, 404);
    } catch (e) {
      return json({ fout: "er ging iets mis" }, 500);
    }
  }
};
