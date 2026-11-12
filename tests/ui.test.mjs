// Ring (nu een zeshoek) en de confetti-kleuren, zonder browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { REPO } from "./lib/omgeving.mjs";

function laadUI() {
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(join(REPO, "ui.js"), "utf8"), ctx);
  return ctx.UI;
}
const UI = laadUI();
const bogen = svg => [...svg.matchAll(/class="ring-arc (\w+)"[^>]*stroke-dasharray="([^"]+)"/g)].map(m => [m[1], m[2]]);
const pct = svg => svg.match(/<text class="ring-pct"[^>]*>(\d+)</)[1];

test("Ring: niets geoefend tekent geen lijnen en 0%", () => {
  const svg = UI.Ring({ known: 0, learning: 0, total: 20 });
  assert.deepEqual(bogen(svg), []);
  assert.equal(pct(svg), "0");
  assert.match(svg, /class="ring-track"/);
});

test("Ring: lengte van de lijnen volgt het aandeel", () => {
  const svg = UI.Ring({ known: 2, learning: 5, total: 20 });
  // learning-lijn = alles geoefend (7 van 20), known-lijn daarbovenop (2 van 20)
  assert.deepEqual(bogen(svg), [["learning", "35.00 100"], ["known", "10.00 100"]]);
  assert.equal(pct(svg), "35");
  assert.match(svg, /pathLength="100"/);
});

test("Ring: alles erin is een volle zeshoek en 100%", () => {
  const svg = UI.Ring({ known: 20, learning: 0, total: 20 });
  assert.deepEqual(bogen(svg), [["learning", "100.00 100"], ["known", "100.00 100"]]);
  assert.equal(pct(svg), "100");
});

test("Ring: te hoge of rare waarden lopen niet over en geven geen NaN", () => {
  const veel = UI.Ring({ known: 30, learning: 10, total: 20 });
  assert.deepEqual(bogen(veel), [["learning", "100.00 100"], ["known", "100.00 100"]]);
  assert.equal(pct(veel), "100");
  for (const o of [{}, { total: 0 }, { known: "x", learning: null, total: undefined }, { known: -3, total: 10 }]) {
    const svg = UI.Ring(o);
    assert.doesNotMatch(svg, /NaN|undefined|Infinity/, JSON.stringify(o));
  }
});

test("Ring: de vorm is een regelmatige zeshoek rond het midden, met de klok mee vanaf boven", () => {
  const svg = UI.Ring({ known: 1, learning: 1, total: 2 });
  const d = svg.match(/class="ring-track" d="([^"]+)"/)[1];
  const punten = [...d.matchAll(/([\d.]+)[ ,]([\d.]+)/g)].map(m => [+m[1], +m[2]]);
  assert.equal(punten.length, 6, "zes hoekpunten");
  assert.match(d, /Z$/, "gesloten pad");
  for (const [x, y] of punten) assert.ok(Math.abs(Math.hypot(x - 32, y - 32) - 26) < 0.05, `hoekpunt ${x},${y} ligt niet op straal 26`);
  for (let i = 0; i < 6; i++) {
    const [a, b] = [punten[i], punten[(i + 1) % 6]];
    assert.ok(Math.abs(Math.hypot(a[0] - b[0], a[1] - b[1]) - 26) < 0.05, "zijden niet even lang");
  }
  assert.deepEqual(punten[0], [32, 6], "begint bovenaan");
  assert.ok(punten[1][0] > 32, "loopt met de klok mee");
  // alle lijnen gebruiken dezelfde vorm, zodat ze precies over elkaar vallen
  assert.equal(new Set([...svg.matchAll(/ d="([^"]+)"/g)].map(m => m[1])).size, 1);
});

test("Ring: verborgen voor schermlezers (de tekst ernaast zegt het al)", () => {
  assert.match(UI.Ring({ total: 1 }), /^<svg[^>]*aria-hidden="true"/);
});

test("confetti: reservekleuren in celebrate.js gelijk aan de tokens in ds.css", () => {
  const css = readFileSync(join(REPO, "ds.css"), "utf8");
  const js = readFileSync(join(REPO, "celebrate.js"), "utf8");
  const tokens = [1, 2, 3, 4].map(n => (css.match(new RegExp("--confetti-" + n + ":\\s*(#[0-9A-Fa-f]{6})")) || [])[1]?.toUpperCase());
  assert.ok(tokens.every(Boolean), "niet alle --confetti-tokens gevonden: " + tokens);
  const reserve = js.match(/out\.length \? out : (\[[^\]]+\])/);
  assert.ok(reserve, "reservelijst niet gevonden in celebrate.js");
  assert.deepEqual(JSON.parse(reserve[1]).map(s => s.toUpperCase()), tokens);
  assert.match(js, /resolveColors\(\["--confetti-1", "--confetti-2", "--confetti-3", "--confetti-4"\]\)/);
});
