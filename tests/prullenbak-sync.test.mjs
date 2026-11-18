// Prullenbak in de sync-worker: een verwijderde eigen lijst komt niet terug
// via een ander toestel, en klaslijsten in de prullenbak (klasWeg) worden
// gecontroleerd en samengevoegd. Pure functies, zonder Cloudflare.
//
// WORKER_SRC=/pad/naar/src laat dezelfde tests op een andere kopie draaien.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO } from "./lib/omgeving.mjs";

const SRC = process.env.WORKER_SRC || join(REPO, "worker", "src");
const M = await import(pathToFileURL(join(SRC, "merge.js")).href);
const { mergeSync } = M;

const NU = 1_800_000_000_000;
const MARGE = 5 * 60 * 1000;
const DAG = 24 * 60 * 60 * 1000;
const json = x => JSON.parse(JSON.stringify(x));
const vg = updated => ({ items: {}, sessions: [], updated });
const lijst = (extra = {}) => ({ id: "custom-1", title: "Lijst", subject: "Engels", added: 100,
  items: [{ word: "cat", def: "kat" }], ...extra });
const steen = (extra = {}) => ({ id: "custom-1", title: "", items: [], ...extra });
// T(n): n minuten na een moment 10 dagen terug, ruim binnen de 30 dagen
const T = n => NU - 10 * DAG + n * 60_000;
const een = (uit, id = "custom-1") => uit.lists.find(l => String(l.id) === String(id));

test("prullenbak: PRULLENBAK_DAGEN is 30", () => {
  assert.equal(M.PRULLENBAK_DAGEN, 30);
});

test("prullenbak: verwijderd wint van een oudere levende kopie, in beide richtingen", () => {
  const weg = lijst({ weg: T(500), bijgewerkt: T(500) });
  const levend = lijst({ bijgewerkt: T(200) });
  assert.equal(een(mergeSync({ lists: [levend] }, { lists: [weg] }, NU)).weg, T(500));
  assert.equal(een(mergeSync({ lists: [weg] }, { lists: [levend] }, NU)).weg, T(500));
  // een grafsteen ook
  const g = steen({ gewist: T(600), bijgewerkt: T(600) });
  assert.equal(een(mergeSync({ lists: [levend] }, { lists: [g] }, NU)).gewist, T(600));
  assert.equal(een(mergeSync({ lists: [g] }, { lists: [levend] }, NU)).gewist, T(600));
});

test("prullenbak: terugzetten wint van een oudere verwijdering", () => {
  const weg = lijst({ weg: T(500), bijgewerkt: T(500) });
  const terug = lijst({ bijgewerkt: T(700) });
  for (const uit of [mergeSync({ lists: [weg] }, { lists: [terug] }, NU), mergeSync({ lists: [terug] }, { lists: [weg] }, NU)]) {
    const l = een(uit);
    assert.equal("weg" in l, false, "lijst staat nog in de prullenbak");
    assert.equal(l.bijgewerkt, T(700));
    assert.equal(l.title, "Lijst");
  }
  // weg: 0 telt als niet in de prullenbak
  const nul = een(mergeSync({ lists: [weg] }, { lists: [lijst({ weg: 0, bijgewerkt: T(700) })] }, NU));
  assert.equal("weg" in nul, false);
});

test("prullenbak: bij gelijke stand wint de grafsteen, anders blijft remote", () => {
  const g = steen({ gewist: T(500), bijgewerkt: T(500) });
  const levend = lijst({ bijgewerkt: T(500) });
  assert.equal(een(mergeSync({ lists: [levend] }, { lists: [g] }, NU)).gewist, T(500), "grafsteen uit de PUT wint niet");
  assert.equal(een(mergeSync({ lists: [g] }, { lists: [levend] }, NU)).gewist, T(500), "levende lijst uit de PUT wint");
  // twee levende met gelijke stand: remote blijft
  const a = lijst({ title: "Remote", bijgewerkt: T(500) });
  const b = lijst({ title: "Lokaal", bijgewerkt: T(500) });
  assert.equal(een(mergeSync({ lists: [a] }, { lists: [b] }, NU)).title, "Remote");
});

test("prullenbak: een oude app zonder bijgewerkt brengt de lijst niet terug", () => {
  // oude app: alleen added, die is lager dan bijgewerkt van de verwijdering
  const oud = lijst({ added: 100 });
  const weg = lijst({ added: 100, weg: T(500), bijgewerkt: T(500) });
  const g = steen({ added: 100, gewist: T(600), bijgewerkt: T(600) });
  assert.equal(een(mergeSync({ lists: [weg] }, { lists: [oud] }, NU)).weg, T(500));
  const uit = een(mergeSync({ lists: [g] }, { lists: [oud] }, NU));
  assert.equal(uit.gewist, T(600));
  assert.deepEqual(uit.items, []);
  // stand is bijgewerkt, anders added, anders 0
  assert.equal(M.stand({ bijgewerkt: 7, added: 9 }), 7);
  assert.equal(M.stand({ added: 9 }), 9);
  assert.equal(M.stand({}), 0);
});

test("prullenbak: na 30 dagen wordt een lijst met weg een grafsteen zonder inhoud", () => {
  const weg = NU - 31 * DAG;
  const uit = een(mergeSync({ lists: [lijst({ weg, bijgewerkt: weg, sections: { A: "x" }, deadline: "2026-09-17" })] }, {}, NU));
  assert.deepEqual(json(uit), { id: "custom-1", title: "", items: [], weg, gewist: weg + 30 * DAG, bijgewerkt: weg + 30 * DAG, added: 100 });
  // zonder bijgewerkt: bijgewerkt wordt gewist
  assert.equal(M.controleerLijst(lijst({ weg }), NU).bijgewerkt, weg + 30 * DAG);
  // precies 30 dagen: nog niet
  const net = M.controleerLijst(lijst({ weg: NU - 30 * DAG }), NU);
  assert.equal("gewist" in net, false);
  assert.equal(net.title, "Lijst");
  // en een grafsteen van buiten verliest zijn inhoud, ook zonder items
  assert.deepEqual(json(M.controleerLijst({ id: "x", title: "Geheim", items: [{ word: "a", def: "b" }], gewist: 5, bijgewerkt: 9 }, NU)),
    { id: "x", title: "", items: [], gewist: 5, bijgewerkt: 9 });
  assert.deepEqual(json(M.controleerLijst({ id: "x", gewist: 5 }, NU)), { id: "x", title: "", items: [], gewist: 5, bijgewerkt: 5 });
  // tijden worden begrensd
  const ver = M.controleerLijst(lijst({ weg: 1e308, bijgewerkt: 1e308 }), NU);
  assert.equal(ver.weg, NU + MARGE);
  assert.equal(ver.bijgewerkt, NU + MARGE);
  assert.equal(M.controleerLijst(steen({ gewist: 1e308 }), NU).gewist, NU + MARGE);
  // kapotte prullenbakvelden vallen weg, de lijst blijft
  const kapot = M.controleerLijst(lijst({ weg: "gisteren", gewist: null, bijgewerkt: "x" }), NU);
  assert.deepEqual(json(kapot), json(M.controleerLijst(lijst(), NU)));
});

test("prullenbak: de voortgang van een grafsteen valt weg, die van een lijst met alleen weg blijft", () => {
  const uit = mergeSync(
    { lists: [lijst({ id: "a", weg: T(500), bijgewerkt: T(500) }), lijst({ id: 7 })], progress: { a: vg(1), b: vg(1), 7: vg(1) } },
    { lists: [steen({ id: "b", gewist: T(600), bijgewerkt: T(600) }), steen({ id: 7, gewist: T(600), bijgewerkt: T(600) })] },
    NU);
  assert.deepEqual(Object.keys(uit.progress).sort(), ["a"]);
  // ook na 30 dagen in de prullenbak
  const oud = mergeSync({ lists: [lijst({ id: "c", weg: NU - 40 * DAG })], progress: { c: vg(1) } }, {}, NU);
  assert.deepEqual(uit.progress.a, vg(1));
  assert.deepEqual(oud.progress, {});
});

test("klasWeg: wordt samengevoegd, hoogste bijgewerkt wint, gelijk blijft remote", () => {
  const uit = mergeSync(
    { klasWeg: { a: { weg: 5, bijgewerkt: 5 }, b: { weg: 5, bijgewerkt: 9 }, c: { weg: 3, bijgewerkt: 4 } } },
    { klasWeg: { a: { weg: 0, bijgewerkt: 8 }, b: { weg: 1, bijgewerkt: 2 }, c: { weg: 0, bijgewerkt: 4 }, d: { weg: 6, bijgewerkt: 6 } } },
    NU);
  assert.deepEqual(json(uit.klasWeg), {
    a: { weg: 0, bijgewerkt: 8 }, b: { weg: 5, bijgewerkt: 9 }, c: { weg: 3, bijgewerkt: 4 }, d: { weg: 6, bijgewerkt: 6 },
  });
  assert.deepEqual(mergeSync({}, {}, NU).klasWeg, {});
});

test("klasWeg: zonder klasWeg in de PUT blijft de remote waarde staan", () => {
  const remote = { klasWeg: { a: { weg: 5, bijgewerkt: 5 } } };
  assert.deepEqual(json(mergeSync(remote, { updated: 3 }, NU).klasWeg), remote.klasWeg);
  assert.deepEqual(json(mergeSync(remote, { klasWeg: "kapot" }, NU).klasWeg), remote.klasWeg);
});

test("klasWeg: kapotte invoer, __proto__, te veel regels en een tijd in de toekomst", () => {
  for (const kapot of [null, "x", 5, [], [{ weg: 1, bijgewerkt: 1 }]]) {
    assert.deepEqual(mergeSync({}, { klasWeg: kapot }, NU).klasWeg, {});
  }
  const raar = JSON.parse('{"__proto__":{"weg":1,"bijgewerkt":1},"constructor":{"weg":1,"bijgewerkt":1},"":{"weg":1,"bijgewerkt":1}}');
  Object.assign(raar, {
    goed: { weg: 1, bijgewerkt: 2, extra: "<b>" },
    geen: null, tekst: "x", rij: [1, 2], zonderWeg: { bijgewerkt: 1 }, kapotWeg: { weg: "x", bijgewerkt: 1 },
    kapotTijd: { weg: 1, bijgewerkt: NaN }, negatief: { weg: -5, bijgewerkt: -1 },
    toekomst: { weg: 1e308, bijgewerkt: 1e308 },
    ["x".repeat(101)]: { weg: 1, bijgewerkt: 1 }, ["y".repeat(100)]: { weg: 1, bijgewerkt: 1 },
  });
  const uit = mergeSync({}, { klasWeg: raar }, NU).klasWeg;
  assert.equal(Object.getPrototypeOf(uit), Object.prototype);
  assert.equal(Object.hasOwn(uit, "__proto__"), false);
  assert.deepEqual(Object.keys(uit).sort(), ["goed", "negatief", "toekomst", "y".repeat(100)].sort());
  assert.deepEqual(uit.goed, { weg: 1, bijgewerkt: 2 });
  assert.deepEqual(uit.negatief, { weg: 0, bijgewerkt: 0 });
  assert.deepEqual(uit.toekomst, { weg: NU + MARGE, bijgewerkt: NU + MARGE });

  // hooguit 200 regels, ook na samenvoegen
  const veel = n => Object.fromEntries(Array.from({ length: n }, (_, i) => ["k" + i, { weg: 1, bijgewerkt: i + 1 }]));
  assert.equal(Object.keys(mergeSync({}, { klasWeg: veel(250) }, NU).klasWeg).length, 200);
  const remote = Object.fromEntries(Array.from({ length: 150 }, (_, i) => ["r" + i, { weg: 1, bijgewerkt: 1000 + i }]));
  const samen = mergeSync({ klasWeg: remote }, { klasWeg: veel(150) }, NU).klasWeg;
  assert.equal(Object.keys(samen).length, 200);
  // de nieuwste blijven: alle remote (1000 en hoger) en de 50 nieuwste lokale
  assert.ok(Object.keys(remote).every(k => k in samen), "nieuwere remote-regel weggevallen");
  assert.ok("k149" in samen && !("k0" in samen));
});
