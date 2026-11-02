const EXTRACT_MODEL = "claude-haiku-5-5";
const ENRICH_MODEL = "claude-sonnet-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";

function cors(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-token",
  };
}

function json(data, status, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors(env) },
  });
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
    throw new Error(`Claude API ${res.status}: ${err}`);
  }
  return res.json();
}

function extractText(response) {
  const block = response.content.find((b) => b.type === "text");
  return block ? block.text : "";
}

function parseJSON(text) {
  const match = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (!match) throw new Error("Geen JSON gevonden in het antwoord");
  return JSON.parse(match[1]);
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
  const { image, mediaType, subjectHint } = await request.json();
  if (!image) return json({ error: "Geen afbeelding meegegeven" }, 400, env);

  const hint = buildHint(subjectHint);
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
  return json(result, 200, env);
}

async function handleSyncGet(learner, env) {
  const data = await env.SYNC.get("learner:" + learner, "json");
  return json(data || {}, 200, env);
}

async function handleSyncPut(learner, request, env) {
  const body = await request.json();
  const existing = await env.SYNC.get("learner:" + learner, "json") || {};
  const merged = mergeSync(existing, body);
  await env.SYNC.put("learner:" + learner, JSON.stringify(merged));
  return json(merged, 200, env);
}

function mergeSync(remote, local) {
  const out = {};
  out.cats = mergeCats(remote.cats || {}, local.cats || {});
  out.progress = mergeProgress(remote.progress || {}, local.progress || {});
  out.lists = mergeLists(remote.lists || [], local.lists || []);
  out.updated = Math.max(remote.updated || 0, local.updated || 0);
  return out;
}

function mergeCats(a, b) {
  const out = Object.assign({}, a);
  for (const src in b) {
    if (!out[src] || (b[src].laatst || 0) > (out[src].laatst || 0)) {
      out[src] = b[src];
    } else if (out[src]) {
      out[src].aantal = Math.max(out[src].aantal || 0, b[src].aantal || 0);
    }
  }
  return out;
}

function mergeProgress(a, b) {
  const out = Object.assign({}, a);
  for (const key in b) {
    if (!out[key] || (b[key].updated || 0) > (out[key].updated || 0)) {
      out[key] = b[key];
    }
  }
  return out;
}

function mergeLists(a, b) {
  const byId = {};
  for (const l of a) byId[l.id] = l;
  for (const l of b) {
    if (!byId[l.id] || (l.added || 0) > (byId[l.id].added || 0)) byId[l.id] = l;
  }
  return Object.values(byId);
}

async function handleEnrich(request, env) {
  const { items, mode, subject } = await request.json();
  if (!items || !items.length) return json({ error: "Geen items meegegeven" }, 400, env);

  const context =
    mode === "translate"
      ? `Dit zijn ${subject || "vreemde taal"}-items met vertalingen.`
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
  return json(result, 200, env);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(env) });
    }

    const token = request.headers.get("x-api-token");
    if (!token || token !== env.APP_SECRET) {
      return json({ error: "Niet geautoriseerd" }, 401, env);
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
        if (request.method === "GET") return await handleSyncGet(syncMatch[1], env);
        if (request.method === "PUT") return await handleSyncPut(syncMatch[1], request, env);
      }
      return json({ error: "Niet gevonden" }, 404, env);
    } catch (e) {
      return json({ error: e.message }, 500, env);
    }
  },
};
