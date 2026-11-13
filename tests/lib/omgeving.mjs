// Gedeelde testomgeving: Playwright vinden, een browser starten, de app
// lokaal serveren en het netwerk naar buiten afschermen.
//
// Er is geen package.json en geen node_modules in deze repo. Playwright
// moet dus al op de machine staan. Zie tests/README.md.
import { createRequire } from "node:module";
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, extname, normalize, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---------- Playwright vinden ----------
// Volgorde: PLAYWRIGHT_MODULE (pad naar een map met node_modules/playwright),
// een gewone require, en als laatste de npx-cache. Er wordt nooit iets
// geinstalleerd of gedownload.
function zoekPlaywright() {
  const kandidaten = [];
  if (process.env.PLAYWRIGHT_MODULE) kandidaten.push(process.env.PLAYWRIGHT_MODULE);
  kandidaten.push(REPO);
  const npx = join(homedir(), ".npm", "_npx");
  if (existsSync(npx)) {
    for (const d of readdirSync(npx)) {
      const p = join(npx, d, "node_modules", "playwright");
      if (existsSync(join(p, "package.json"))) kandidaten.push(join(npx, d));
    }
  }
  for (const k of kandidaten) {
    try { return createRequire(join(k, "noop.js"))("playwright"); }
    catch (_) { /* volgende */ }
  }
  return null;
}

// De browser van de geinstalleerde Playwright-versie staat er soms niet,
// wel een iets oudere in de cache. Die gebruiken we dan, zonder download.
function zoekChromium() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), "Library", "Caches", "ms-playwright");
  const alt = join(homedir(), ".cache", "ms-playwright");
  for (const basis of [cache, alt]) {
    if (!existsSync(basis)) continue;
    const mappen = readdirSync(basis).filter(d => /^chromium(_headless_shell)?-\d+$/.test(d))
      .sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()) || (a.includes("headless") ? -1 : 1));
    for (const m of mappen) {
      const opties = [
        join(basis, m, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
        join(basis, m, "chrome-headless-shell-mac-x64", "chrome-headless-shell"),
        join(basis, m, "chrome-headless-shell-linux64", "chrome-headless-shell"),
        join(basis, m, "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
        join(basis, m, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
        join(basis, m, "chrome-linux", "chrome")
      ];
      for (const o of opties) if (existsSync(o)) return o;
    }
  }
  return null;
}

export async function startBrowser() {
  const pw = zoekPlaywright();
  if (!pw) throw new Error("Playwright niet gevonden. Zie tests/README.md (PLAYWRIGHT_MODULE).");
  let browser;
  try {
    browser = await pw.chromium.launch();
  } catch (e) {
    if (!/Executable doesn't exist/.test(e.message)) throw e;
    const pad = zoekChromium();
    if (!pad) throw new Error("Geen Chromium gevonden in de Playwright-cache. Zie tests/README.md (PW_CHROMIUM).");
    browser = await pw.chromium.launch({ executablePath: pad });
  }
  return zonderWelkom(browser);
}

// Het welkom (bij het openen, een keer per sessie) ligt even over de app
// en maakt hem inert. De meeste tests openen de app en willen meteen
// klikken, dus elk tabblad krijgt de sessievlag van het welkom al.
// newContext({ welkom: true }) laat dat weg; tests/welkom.test.mjs test
// het welkom zelf.
export const WELKOM_SESSIE = "overhoor:welkom:sessie";
export const WELKOM_DAG = "overhoor:welkom:dag";   // oude dagregel, wordt niet meer geschreven
function zonderWelkom(browser) {
  const echt = browser.newContext.bind(browser);
  browser.newContext = async (opties = {}) => {
    const { welkom = false, ...rest } = opties;
    const context = await echt(rest);
    if (!welkom) await context.addInitScript(sleutel => {
      try { sessionStorage.setItem(sleutel, "1"); } catch (_) { /* geen opslag: dan is er ook geen welkom */ }
    }, WELKOM_SESSIE);
    return context;
  };
  return browser;
}

// ---------- lokale server ----------
// Een eigen kleine server in Node: geen python nodig, juiste MIME-types
// (de service worker en fonts zijn daar kieskeurig over) en een vrije
// poort die het besturingssysteem kiest. Altijd op "localhost", want de
// app registreert de service worker alleen op https of localhost.
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8"
};

//
// Optie { zoalsCloudflare: true } bootst Workers static assets met
// html_handling "auto-trailing-slash" na: /index.html geeft een 307 naar /,
// /pagina.html een 307 naar /pagina, en /pagina serveert pagina.html.
export function startServer({ zoalsCloudflare = false } = {}) {
  const server = createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
    let pad = decodeURIComponent(u.pathname);
    if (zoalsCloudflare) {
      if (pad.endsWith(".html")) {
        const doel = pad.endsWith("/index.html") ? pad.slice(0, -"index.html".length) : pad.slice(0, -".html".length);
        res.writeHead(307, { Location: doel + u.search, "Cache-Control": "no-store" });
        return res.end();
      }
      if (!extname(pad) && !pad.endsWith("/") && existsSync(join(REPO, pad + ".html"))) pad += ".html";
    }
    let bestand = normalize(join(REPO, pad));
    if (!bestand.startsWith(REPO)) { res.writeHead(403); return res.end(); }
    if (existsSync(bestand) && statSync(bestand).isDirectory()) bestand = join(bestand, "index.html");
    if (!existsSync(bestand)) { res.writeHead(404); return res.end("niet gevonden"); }
    res.writeHead(200, { "Content-Type": MIME[extname(bestand)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(readFileSync(bestand));
  });
  return new Promise(ok => server.listen(0, "localhost", () => {
    const { port } = server.address();
    ok({ url: "http://localhost:" + port, stop: () => new Promise(r => { server.closeAllConnections?.(); server.close(() => r()); }) });
  }));
}

// ---------- netwerk naar buiten ----------
// Niets gaat echt naar buiten. De sync-worker krijgt een leeg, fictief
// antwoord; al het andere externe verkeer wordt geblokkeerd en genoteerd,
// zodat een test kan zeggen of er iets naar Google of elders ging.
export async function schermNetwerkAf(context) {
  const extern = [];
  await context.route(url => !/^https?:\/\/localhost(:\d+)?\//.test(url.href) && !url.href.startsWith("data:") && !url.href.startsWith("blob:"), route => {
    const u = route.request().url();
    extern.push(u);
    if (/workers\.dev\//.test(u)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}",
        headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,PUT,POST" } });
    }
    return route.abort("blockedbyclient");
  });
  return extern;
}

// ---------- fouten verzamelen ----------
// Ongevangen fouten, console.error en mislukte lokale verzoeken (404).
export function volgFouten(page) {
  const fouten = [];
  page.on("pageerror", e => fouten.push("JS-fout: " + e.message));
  page.on("console", m => { if (m.type() === "error") fouten.push("console.error: " + m.text()); });
  page.on("response", r => { if (r.url().includes("localhost") && r.status() >= 400) fouten.push("HTTP " + r.status() + ": " + r.url()); });
  page.on("requestfailed", r => {
    const u = r.url();
    if (u.includes("localhost")) fouten.push("verzoek mislukt: " + u + " (" + (r.failure()?.errorText || "") + ")");
  });
  return fouten;
}

export const THEMAS = ["light", "dark"];
export const BREEDTES = [360, 1280];
