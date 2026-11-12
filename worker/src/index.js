import { mergeSync, HttpFout } from "./merge.js";

const EXTRACT_MODEL = "claude-haiku-5-5";
const ENRICH_MODEL = "claude-sonnet-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_SYNC_BYTES = 1024 * 1024; // 1 MiB per PUT /sync
const MAX_RECORD_BYTES = 2 * 1024 * 1024; // 2 MiB voor het samengevoegde record
const MAX_EXTRACT_BYTES = 8 * 1024 * 1024; // 8 MiB, foto als base64
const MAX_ENRICH_BYTES = 64 * 1024; // 64 KiB
const MAX_ENRICH_ITEMS = 200;
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

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
    "Access-Control-Allow-Headers": "Content-Type, x-api-token",
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
class UpstreamFout extends Error {}

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

async function callClaude(model, messages, env) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: 8192, messages }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new UpstreamFout(`Claude API ${res.status}: ${err}`);
  }
  return res.json();
}

function extractText(response) {
  const block = response.content.find((b) => b.type === "text");
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

async function handleExtract(request, env) {
  const { image, mediaType, subjectHint } = await leesJson(request, MAX_EXTRACT_BYTES);
  if (typeof image !== "string" || !image) {
    return json({ error: "Geen afbeelding meegegeven" }, 400, env, request);
  }
  if (mediaType !== undefined && !MEDIA_TYPES.includes(mediaType)) {
    return json({ error: "Onbekend afbeeldingstype" }, 400, env, request);
  }

  const hint = buildHint(typeof subjectHint === "string" ? subjectHint : "");
  const prompt = EXTRACT_PROMPT + "\n\nHINT VAN DE GEBRUIKER: " + hint;

  const response = await callClaude(
    EXTRACT_MODEL,
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
  );

  const text = extractText(response);
  const result = parseJSON(text);
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

async function handleEnrich(request, env) {
  const { items, mode, subject } = await leesJson(request, MAX_ENRICH_BYTES);
  if (!Array.isArray(items) || !items.length) {
    return json({ error: "Geen items meegegeven" }, 400, env, request);
  }
  if (items.length > MAX_ENRICH_ITEMS) {
    return json({ error: "Te veel items" }, 400, env, request);
  }

  const context =
    mode === "translate"
      ? `Dit zijn ${typeof subject === "string" && subject ? subject : "vreemde taal"}-items met vertalingen.`
      : `Dit zijn Engelse vocabulaire-items met Engelse definities.`;

  const response = await callClaude(
    ENRICH_MODEL,
    [
      {
        role: "user",
        content: `${ENRICH_PROMPT}\n\n${context}\n\nItems:\n${JSON.stringify(items, null, 2)}`,
      },
    ],
    env
  );

  const text = extractText(response);
  const result = parseJSON(text);
  return json(result, 200, env, request);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(env, request) });
    }

    const token = request.headers.get("x-api-token");
    if (!token || token !== env.APP_SECRET) {
      return json({ error: "Niet geautoriseerd" }, 401, env, request);
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/extract" && request.method === "POST") {
        return await handleExtract(request, env);
      }
      if (url.pathname === "/enrich" && request.method === "POST") {
        return await handleEnrich(request, env);
      }
      const syncMatch = url.pathname.match(/^\/sync\/([a-z0-9-]+)$/);
      if (syncMatch) {
        if (request.method === "GET") return await handleSyncGet(syncMatch[1], env, request);
        if (request.method === "PUT") return await handleSyncPut(syncMatch[1], request, env);
      }
      return json({ error: "Niet gevonden" }, 404, env, request);
    } catch (e) {
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
