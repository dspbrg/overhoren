// Als app op het beginscherm van een iPhone loopt de pagina onder de
// statusbalk door (black-translucent, viewport-fit=cover). De paginarand
// moet daarom de veilige rand van iOS meetellen, anders valt de kop weg.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(REPO, "ds.css"), "utf8");
const html = readFileSync(join(REPO, "index.html"), "utf8");

// de declaraties van een selector, zonder commentaar
function regel(sel) {
  const schoon = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const m = new RegExp("(^|[{}])\\s*" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}", "m").exec(schoon);
  assert.ok(m, "geen regel voor " + sel);
  return m[2];
}

test("veilige rand: tokens tellen env(safe-area-inset-*) mee aan alle vier de kanten", () => {
  for (const [token, kant] of [["--rand-boven", "top"], ["--rand-onder", "bottom"], ["--rand-links", "left"], ["--rand-rechts", "right"]]) {
    assert.match(css, new RegExp(token + ":\\s*calc\\([^;]*env\\(safe-area-inset-" + kant), token + " mist de veilige rand");
  }
});

test("veilige rand: de pagina en het welkom gebruiken hem", () => {
  for (const sel of ["body", ".welkom"]) {
    const r = regel(sel);
    assert.match(r, /padding:\s*var\(--rand-boven\)\s+var\(--rand-rechts\)\s+var\(--rand-onder\)\s+var\(--rand-links\)/, sel + " houdt geen rekening met de statusbalk");
  }
});

test("veilige rand: viewport-fit=cover en een doorschijnende statusbalk, waar de rand voor nodig is", () => {
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /apple-mobile-web-app-status-bar-style" content="black-translucent"/);
});
