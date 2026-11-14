import { mergeSync, HttpFout } from "./merge.js";
import { FotoTeller, FOTO_PER_TOESTEL_PER_DAG, FOTO_PER_MAAND, MELD_DREMPELS, dagVan } from "./teller.js";

// Foto-import zonder wachtwoord, met twee grenzen (Europe/Amsterdam): per
// toestel per kalenderdag, en voor iedereen samen per kalendermaand. Ze
// gelden voor /extract en /enrich elk apart en staan in teller.js. De
// Durable Object FotoTeller telt atomair en vooraf.
export { FotoTeller, FOTO_PER_TOESTEL_PER_DAG, FOTO_PER_MAAND, MELD_DREMPELS, dagVan };

const EXTRACT_MODEL = "claude-haiku-5-5";
const ENRICH_MODEL = "claude-sonnet-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";
// Een bladzijde levert hooguit een paar honderd regels JSON op.
const EXTRACT_MAX_TOKENS = 4096;
// Per woord ongeveer 60 tot 80 tokens (keys, een voorbeeldzin, accept en
// het woord zelf). Een gewone bladzijde van 20 tot 40 woorden past in
// 3000; 8192 laat ruimte voor ruim 100 woorden. Ergste geval per verrijking
// (Sonnet 5.5, $2 in en $10 uit per miljoen tokens, prijzen van 14-11-2026):
// 64 KiB invoer is hooguit ongeveer 22.000 tokens ($0,044) plus 8192 tokens
// uitvoer ($0,082), samen ongeveer $0,13. Een foto (Haiku 5.5) kost in het
// ergste geval ongeveer $0,003.
const ENRICH_MAX_TOKENS = 8192;
const MAX_SYNC_BYTES = 1024 * 1024; // 1 MiB per PUT /sync
const MAX_RECORD_BYTES = 2 * 1024 * 1024; // 2 MiB voor het samengevoegde record
// Foto als base64: hooguit 2 MiB. De app stuurt een JPEG van hooguit
// 1500 px, ruim onder 1 MiB. De body mag daarbovenop 1 KiB aan velden hebben.
const MAX_IMAGE_CHARS = 2 * 1024 * 1024;
const MAX_EXTRACT_BYTES = MAX_IMAGE_CHARS + 1024;
const MAX_ENRICH_BYTES = 64 * 1024; // 64 KiB
const MAX_ENRICH_ITEMS = 150;
const MAX_ENRICH_TEKST = 200; // tekens per word of def
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
// Taal in een hint of vak: alleen letters, hooguit 20.
const TAAL = /^\p{L}{1,20}$/u;
// Toestel-id: crypto.randomUUID() uit de app, in kleine letters.
const TOESTEL_VORM = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Een oude app zonder toestel-id, maar met het wachtwoord, telt onder dit id.
const TOESTEL_WACHTWOORD = "wachtwoord";

// ALLOWED_ORIGIN is een lijst, gescheiden door komma's. Alleen een herkende
// Origin gaat terug in Access-Control-Allow-Origin; anders geen CORS-kop.
function cors(env, request) {
  const toegestaan = String(env.ALLOWED_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = request ? request.headers.get("Origin") : null;
  const h = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-token, x-toestel",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && toegestaan.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(data, status, env, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors(env, request) },
  });
}

// Fout van de Anthropic-API. De details gaan alleen naar console.error.
// betaald: false alleen bij een storing aan de kant van Anthropic (429,
// 500 en hoger, zoals 529). Een 4xx door de invoer of een netwerkfout kan
// al geld gekost hebben en blijft geteld.
class UpstreamFout extends Error {
  constructor(bericht, betaald = true) {
    super(bericht);
    this.betaald = betaald;
  }
}

// Leest een JSON-body van hooguit max bytes. Groter: 413. Geen geldig
// JSON-object: 400.
async function leesJson(request, max) {
  const lengte = Number(request.headers.get("content-length"));
  if (Number.isFinite(lengte) && lengte > max) throw new HttpFout(413, "Verzoek te groot");
  const delen = [];
  let totaal = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totaal += value.byteLength;
      if (totaal > max) {
        await reader.cancel().catch(() => {});
        throw new HttpFout(413, "Verzoek te groot");
      }
      delen.push(value);
    }
  }
  const buf = new Uint8Array(totaal);
  let pos = 0;
  for (const d of delen) {
    buf.set(d, pos);
    pos += d.byteLength;
  }
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(buf));
  } catch (e) {
    throw new HttpFout(400, "Ongeldige JSON");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new HttpFout(400, "Ongeldige JSON");
  }
  return data;
}

async function callClaude(model, maxTokens, messages, env) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
    });
  } catch (e) {
    throw new UpstreamFout("Claude API onbereikbaar: " + (e && e.message));
  }
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    const storing = res.status === 429 || res.status >= 500;
    throw new UpstreamFout(`Claude API ${res.status}: ${err}`, !storing);
  }
  return res.json();
}

function extractText(response) {
  const block = response && Array.isArray(response.content) ? response.content.find((b) => b.type === "text") : null;
  return block ? block.text : "";
}

function parseJSON(text) {
  const match = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (!match) throw new UpstreamFout("Geen JSON gevonden in het antwoord");
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    throw new UpstreamFout("Ongeldige JSON in het antwoord: " + e.message);
  }
}

const EXTRACT_PROMPT = `Je bent een assistent die vocabulaire uit een schoolboek-foto haalt voor een overhoor-app.

Analyseer de foto en extraheer alle vocabulaire-items. Bepaal het type:

1. **Engelse woordenlijst** (woord + Engelse definitie, GEEN woordsoort):
   mode: "three", subject: "Engels"
   Items: { "word": "...", "def": "..." }

2. **Vertaalparen** (bijv. Frans-Nederlands):
   mode: "translate", subject: de taal (bijv. "Frans")
   Vul from/to in (bijv. from: "Frans", to: "Nederlands")
   directions: ["wd","dw"] (twee kanten op)
   Items: { "word": "...", "def": "..." }

3. **Grammatica-oefeningen** (zinnen met invulling):
   mode: "translate", strict: true
   word = de opdracht, def = het goede antwoord (meerdere gescheiden door /)

Geef ALLEEN valide JSON terug, geen uitleg:
{
  "mode": "three" of "translate",
  "subject": "Engels" of "Frans" of ...,
  "title": "beschrijvende titel op basis van wat je ziet",
  "from": "..." (alleen bij translate),
  "to": "..." (alleen bij translate),
  "directions": ["wd","dw"] (bij translate, standaard twee kanten op),
  "strict": true/false (alleen bij translate, true voor grammatica),
  "items": [
    { "word": "...", "def": "..." }
  ]
}

Belangrijk:
- Extraheer ALLE zichtbare items op de pagina
- GEEN woordsoorten (cls) meegeven, ook niet voor Engels
- Bij vertalingen: scheid meerdere goede vertalingen met /
- Bewaar de originele taal exact zoals geschreven
- Als items gegroepeerd zijn met letters (A, B, C), voeg een "section" veld toe`;

const ENRICH_PROMPT = `Je verrijkt vocabulaire-items voor een overhoor-app. Voor elk item, genereer:

1. **keys**: Arrays van synoniemgroepen voor soepel nakijken. Elke groep is een array woorden die één kernconcept uit de definitie vangen. Een leerling die een woord uit de groep gebruikt, laat zien dat hij/zij het concept begrijpt. Minimaal 2 groepen per item. Gebruik Engelse woorden voor Engelse definities, Nederlandse voor Nederlandse.

2. **ex**: Een voorbeeldzin met het woord tussen [haken]. Bij meerdere goede vormen: [woord|alternatief]. De zin moet natuurlijk zijn en passen bij een 12-jarige. Doe dit ook voor vertalingen (bijv. een Franse zin voor een Frans woord).

3. **accept**: Korte antwoorden die altijd goed moeten zijn (alleen als er duidelijke korte synoniemen bestaan). Laat weg als er geen voor de hand liggende korte antwoorden zijn.

Geef de items array terug met de toegevoegde velden. Houd bestaande word en def EXACT hetzelfde.

Geef ALLEEN valide JSON terug: { "items": [...] }`;

function buildHint(subjectHint) {
  if (!subjectHint) return "Bepaal zelf het type op basis van wat je ziet.";
  if (subjectHint === "zinnen") return 'Dit zijn grammatica/zinsoefeningen. Gebruik mode: "translate", strict: true. word = de opdracht of zin, def = het goede antwoord (meerdere gescheiden door /). Bepaal de taal en vul from/to in.';
  if (subjectHint === "anders") return "Bepaal zelf het type op basis van wat je ziet.";
  const parts = subjectHint.split(":");
  if (parts.length === 2) {
    const dir = parts[0], lang = parts[1];
    if (dir === "wd") return `Dit is een ${lang}e woordenlijst. Gebruik mode: "translate", subject: "${lang}", from: "${lang}", to: "Nederlands", directions: ["wd","dw"]. De foto toont ${lang}e woorden met Nederlandse vertalingen.`;
    if (dir === "dw") return `Dit is een ${lang}e woordenlijst. Gebruik mode: "translate", subject: "${lang}", from: "${lang}", to: "Nederlands", directions: ["wd","dw"]. De foto toont Nederlandse woorden met ${lang}e vertalingen. Let op: "word" moet het ${lang}e woord zijn en "def" de Nederlandse vertaling (draai om als nodig).`;
  }
  return "Bepaal zelf het type op basis van wat je ziet.";
}

// ---------- foto-import: rand, teller en drempels ----------

// Per IP hooguit een handvol verzoeken per minuut (Cloudflare Rate Limiting,
// per locatie bij benadering). Dit komt voor de teller en voor het lezen van
// de body, zodat een stroom verzoeken de teller en /sync niet kan bezetten.
async function binnenTempo(request, env) {
  if (!env.FOTO_TEMPO) throw new Error("FOTO_TEMPO ontbreekt");
  const ip = request.headers.get("CF-Connecting-IP") || "onbekend";
  const { success } = await env.FOTO_TEMPO.limit({ key: ip });
  return success;
}

// Toestel uit x-toestel. Zonder die kop mag een oude app met het juiste
// wachtwoord nog, onder een vast id. Verder: 400.
function leesToestel(request, env) {
  const id = request.headers.get("x-toestel");
  if (id === null) {
    const token = request.headers.get("x-api-token");
    if (token && env.APP_SECRET && token === env.APP_SECRET) return TOESTEL_WACHTWOORD;
    throw new HttpFout(400, "Ongeldig toestel");
  }
  if (id.length !== 36 || !TOESTEL_VORM.test(id)) throw new HttpFout(400, "Ongeldig toestel");
  return id;
}

function teller(env) {
  if (!env.TELLER) throw new Error("TELLER ontbreekt");
  return env.TELLER.get(env.TELLER.idFromName("foto"));
}

async function vraagTeller(env, pad, data) {
  const res = await teller(env).fetch("https://teller" + pad, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Teller gaf " + res.status);
  return res.json();
}

// Reserveert vooraf een plek. Bij een volle grens: 429 met de grens.
async function reserveer(env, soort, toestel) {
  const r = await vraagTeller(env, "/reserveer", { soort, toestel });
  if (!r.ok) throw new GrensFout(r.grens === "maand" ? "maand" : "toestel");
  for (const d of r.drempels || []) {
    try { await meldDrempel(env, r.maand, d); } catch (e) { console.error("Melding mislukt"); }
  }
  return { soort, toestel, dag: r.dag, maand: r.maand };
}

// Alleen bij een storing aan de kant van Anthropic.
async function boekTerug(env, plek) {
  try { await vraagTeller(env, "/terugboeken", plek); } catch (e) { console.error("Terugboeken mislukt"); }
}

class GrensFout extends Error {
  constructor(grens) {
    super("Grens bereikt");
    this.grens = grens;
  }
}

// Haak voor de melding naar het dashboard bij 80 en 100 foto's in een maand.
// Nog niet gebouwd: doet niets en gaat niet het net op.
export async function meldDrempel(env, maand, drempel) {
  return false;
}

async function metPlek(env, plek, aanroep) {
  try {
    return await aanroep();
  } catch (e) {
    if (e instanceof UpstreamFout && !e.betaald) await boekTerug(env, plek);
    throw e;
  }
}

function geldigeHint(hint) {
  if (hint === undefined || hint === null || hint === "") return "";
  if (hint === "zinnen" || hint === "anders") return hint;
  if (typeof hint === "string") {
    const m = hint.match(/^(wd|dw):(.*)$/);
    if (m && TAAL.test(m[2])) return hint;
  }
  throw new HttpFout(400, "Ongeldige hint");
}

async function handleExtract(request, env) {
  const toestel = leesToestel(request, env);
  const { image, mediaType, subjectHint } = await leesJson(request, MAX_EXTRACT_BYTES);
  if (typeof image !== "string" || !image) {
    return json({ error: "Geen afbeelding meegegeven" }, 400, env, request);
  }
  if (image.length > MAX_IMAGE_CHARS) throw new HttpFout(413, "Verzoek te groot");
  if (!BASE64.test(image)) return json({ error: "Ongeldige afbeelding" }, 400, env, request);
  if (mediaType !== undefined && !MEDIA_TYPES.includes(mediaType)) {
    return json({ error: "Onbekend afbeeldingstype" }, 400, env, request);
  }
  const hint = buildHint(geldigeHint(subjectHint));
  const prompt = EXTRACT_PROMPT + "\n\nHINT VAN DE GEBRUIKER: " + hint;

  const plek = await reserveer(env, "extract", toestel);
  const response = await metPlek(env, plek, () => callClaude(
    EXTRACT_MODEL,
    EXTRACT_MAX_TOKENS,
    [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType || "image/jpeg", data: image },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
    env
  ));

  const result = parseJSON(extractText(response));
  return json(result, 200, env, request);
}

async function handleEnrich(request, env) {
  const toestel = leesToestel(request, env);
  const { items, mode, subject } = await leesJson(request, MAX_ENRICH_BYTES);
  if (!Array.isArray(items) || !items.length) {
    return json({ error: "Geen items meegegeven" }, 400, env, request);
  }
  if (items.length > MAX_ENRICH_ITEMS) {
    return json({ error: "Te veel items" }, 400, env, request);
  }
  // Alleen word en def, als korte tekst. De rest gaat niet naar de AI.
  const schoon = [];
  for (const it of items) {
    if (!it || typeof it !== "object" || typeof it.word !== "string" || typeof it.def !== "string" ||
        it.word.length > MAX_ENRICH_TEKST || it.def.length > MAX_ENRICH_TEKST) {
      return json({ error: "Ongeldig item" }, 400, env, request);
    }
    schoon.push({ word: it.word, def: it.def });
  }
  // Een vak dat geen korte taalnaam is, wordt een algemene omschrijving.
  const taal = typeof subject === "string" && TAAL.test(subject) ? subject : "vreemde taal";
  const context =
    mode === "translate"
      ? `Dit zijn ${taal}-items met vertalingen.`
      : `Dit zijn Engelse vocabulaire-items met Engelse definities.`;

  const plek = await reserveer(env, "enrich", toestel);
  const response = await metPlek(env, plek, () => callClaude(
    ENRICH_MODEL,
    ENRICH_MAX_TOKENS,
    [
      {
        role: "user",
        content: `${ENRICH_PROMPT}\n\n${context}\n\nItems:\n${JSON.stringify(schoon)}`,
      },
    ],
    env
  ));

  const result = parseJSON(extractText(response));
  return json(result, 200, env, request);
}

async function handleSyncGet(learner, env, request) {
  const data = await env.SYNC.get("learner:" + learner, "json");
  if (!data) return json({}, 200, env, request);
  // Alleen de bekende velden, gecontroleerd. Oude of onbekende velden in KV
  // (zoals `katten`) gaan niet terug naar de client.
  return json(mergeSync(data, {}), 200, env, request);
}

async function handleSyncPut(learner, request, env) {
  const body = await leesJson(request, MAX_SYNC_BYTES);
  const existing = (await env.SYNC.get("learner:" + learner, "json")) || {};
  const merged = mergeSync(existing, body);
  const tekst = JSON.stringify(merged);
  if (new TextEncoder().encode(tekst).byteLength > MAX_RECORD_BYTES) {
    throw new HttpFout(413, "Opgeslagen gegevens te groot");
  }
  await env.SYNC.put("learner:" + learner, tekst);
  return json(merged, 200, env, request);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(env, request) });
    }

    const url = new URL(request.url);

    try {
      // Foto-import: open voor iedereen, begrensd per IP, per toestel per dag
      // en per maand. Een wachtwoord verandert daar niets aan.
      const foto = request.method === "POST" && (url.pathname === "/extract" || url.pathname === "/enrich");
      if (foto) {
        if (!(await binnenTempo(request, env))) {
          return json({ error: "Te veel verzoeken", grens: "tempo" }, 429, env, request);
        }
        return url.pathname === "/extract" ? await handleExtract(request, env) : await handleEnrich(request, env);
      }

      // Al het andere (de sync) alleen met het wachtwoord.
      const token = request.headers.get("x-api-token");
      if (!token || token !== env.APP_SECRET) {
        return json({ error: "Niet geautoriseerd" }, 401, env, request);
      }
      const syncMatch = url.pathname.match(/^\/sync\/([a-z0-9-]+)$/);
      if (syncMatch) {
        if (request.method === "GET") return await handleSyncGet(syncMatch[1], env, request);
        if (request.method === "PUT") return await handleSyncPut(syncMatch[1], request, env);
      }
      return json({ error: "Niet gevonden" }, 404, env, request);
    } catch (e) {
      if (e instanceof GrensFout) return json({ error: "Grens bereikt", grens: e.grens }, 429, env, request);
      if (e instanceof HttpFout) return json({ error: e.message }, e.status, env, request);
      // Details alleen in de logs, zonder verzoekinhoud.
      console.error(e && e.message ? e.message : e);
      if (e instanceof UpstreamFout) {
        return json({ error: "De AI-dienst gaf een fout. Probeer het later opnieuw." }, 502, env, request);
      }
      return json({ error: "Er ging iets mis op de server." }, 500, env, request);
    }
  },
};
