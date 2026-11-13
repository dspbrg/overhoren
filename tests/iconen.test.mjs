// Het app-icoon: wat manifest.json, index.html en designsystem.html
// aanwijzen moet bestaan, de opgegeven maat hebben en dicht zijn.
// Een doorzichtig icoon krijgt op iOS een zwarte achtergrond en wordt
// als "maskable" op Android slordig bijgesneden.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const lees = p => readFileSync(join(REPO, p), "utf8");
const manifest = JSON.parse(lees("manifest.json"));

// Breedte, hoogte en of het bestand doorzichtigheid kan hebben, uit de
// PNG-kop. Kleurtype 4 en 6 hebben een alfakanaal; een tRNS-blok maakt
// ook een kleur doorzichtig.
function png(pad) {
  const b = readFileSync(join(REPO, pad));
  assert.equal(b.subarray(1, 4).toString("latin1"), "PNG", pad + " is geen PNG");
  const breedte = b.readUInt32BE(16), hoogte = b.readUInt32BE(20), kleurtype = b[25];
  let tRNS = false;
  for (let i = 8; i < b.length; ) {
    const lengte = b.readUInt32BE(i), soort = b.subarray(i + 4, i + 8).toString("latin1");
    if (soort === "tRNS") tRNS = true;
    if (soort === "IEND") break;
    i += 12 + lengte;
  }
  return { breedte, hoogte, doorzichtig: kleurtype === 4 || kleurtype === 6 || tRNS };
}

// alle <link ...> met een bepaalde rel
function links(html, rel) {
  return [...html.matchAll(/<link\b[^>]*>/g)].map(m => m[0])
    .filter(l => new RegExp('rel="' + rel + '"').test(l))
    .map(l => (/href="([^"]*)"/.exec(l) || [])[1]);
}

test("iconen: elk icoon in het manifest bestaat, heeft de opgegeven maat en is dicht", () => {
  assert.ok(manifest.icons.length > 0, "manifest heeft geen iconen");
  for (const ic of manifest.icons) {
    assert.ok(existsSync(join(REPO, ic.src)), ic.src + " bestaat niet");
    const [w, h] = ic.sizes.split("x").map(Number);
    const p = png(ic.src);
    assert.deepEqual([p.breedte, p.hoogte], [w, h], ic.src + " is niet " + ic.sizes);
    assert.equal(p.doorzichtig, false, ic.src + " heeft doorzichtigheid");
  }
});

test("iconen: het manifest heeft een icoon van 192 en 512, en een maskable", () => {
  const maten = manifest.icons.map(i => i.sizes);
  assert.ok(maten.includes("192x192") && maten.includes("512x512"), "192 of 512 ontbreekt");
  assert.ok(manifest.icons.some(i => /\bmaskable\b/.test(i.purpose)), "geen maskable icoon");
});

test("iconen: de apple-touch-icon is 180 bij 180 en dicht", () => {
  const [href] = links(lees("index.html"), "apple-touch-icon");
  assert.ok(href, "index.html heeft geen apple-touch-icon");
  const p = png(href);
  assert.deepEqual([p.breedte, p.hoogte], [180, 180]);
  assert.equal(p.doorzichtig, false, href + " heeft doorzichtigheid");
});

for (const pagina of ["index.html", "designsystem.html"]) {
  test("iconen: de favicon van " + pagina + " verwijst naar een bestaand bestand, geen emoji", () => {
    const html = lees(pagina);
    const hrefs = links(html, "icon");
    assert.ok(hrefs.length > 0, pagina + " heeft geen favicon");
    for (const href of hrefs) {
      assert.doesNotMatch(href, /^data:/, pagina + " heeft nog een ingebouwde (emoji-)favicon");
      assert.ok(existsSync(join(REPO, href)), href + " bestaat niet");
    }
    assert.doesNotMatch(html, /&#128218;|\u{1F4DA}/u, pagina + " heeft nog de boeken-emoji");
  });
}
