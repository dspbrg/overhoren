#!/usr/bin/env node
// Tekent kattenplaatjes als SVG in cats/.
//
// Waarom zelf tekenen: de repo is openbaar, en meme-afbeeldingen van
// internet zijn vrijwel altijd auteursrechtelijk beschermd. Deze zijn van
// onszelf, wegen een paar kB en blijven scherp op elk scherm.
//
// Gebruik:  node scripts/maak-katten.js
// Daarna:   bash scripts/maak-catalogus.sh

const fs = require("fs");
const path = require("path");
const UIT = path.join(__dirname, "..", "cats");

// --- bouwstenen ------------------------------------------------------
const VACHT = {
  oranje:  { basis: "#E8944A", donker: "#C97533", buik: "#F7C89B" },
  grijs:   { basis: "#8E97A6", donker: "#6E7787", buik: "#D2D8E0" },
  zwart:   { basis: "#3B3746", donker: "#2A2733", buik: "#5C5668" },
  wit:     { basis: "#F2EFE9", donker: "#D8D3C9", buik: "#FFFFFF" },
  cyperse: { basis: "#A8794E", donker: "#7E5836", buik: "#E3C7A4" },
  room:    { basis: "#EBD3A8", donker: "#CDB182", buik: "#FAEBD0" },
  blauw:   { basis: "#7E8FB5", donker: "#5F6E90", buik: "#C3CDE2" },
  rood:    { basis: "#C4643F", donker: "#9C4B2D", buik: "#EBA37C" }
};
const ACHTERGROND = ["#FFD9A0", "#BFE3D0", "#CFD8F7", "#F7C9D9", "#FBE6A2", "#C9E9F2", "#E3D5F5", "#FFD0B8"];

function oog(stijl, x, y) {
  if (stijl === "boos")     return `<path d="M${x-9} ${y-4} L${x+9} ${y+1}" stroke="#2A2733" stroke-width="3.5" stroke-linecap="round" fill="none"/>
                                    <circle cx="${x}" cy="${y+5}" r="4.2" fill="#2A2733"/>`;
  if (stijl === "slaap")    return `<path d="M${x-8} ${y} q8 6 16 0" stroke="#2A2733" stroke-width="3.5" stroke-linecap="round" fill="none"/>`;
  if (stijl === "groot")    return `<circle cx="${x}" cy="${y}" r="10" fill="#fff"/><circle cx="${x}" cy="${y}" r="7" fill="#2A2733"/>
                                    <circle cx="${x+3}" cy="${y-3}" r="2.4" fill="#fff"/>`;
  if (stijl === "blij")     return `<path d="M${x-8} ${y+3} q8 -10 16 0" stroke="#2A2733" stroke-width="3.5" stroke-linecap="round" fill="none"/>`;
  if (stijl === "schuin")   return `<ellipse cx="${x}" cy="${y}" rx="8" ry="9" fill="#fff"/>
                                    <ellipse cx="${x+2}" cy="${y}" rx="3.4" ry="8" fill="#2A2733"/>`;
  return `<circle cx="${x}" cy="${y}" r="8.5" fill="#fff"/><circle cx="${x}" cy="${y}" r="5" fill="#2A2733"/>
          <circle cx="${x+2}" cy="${y-2}" r="1.8" fill="#fff"/>`;
}

function accessoire(soort) {
  if (soort === "feestmuts") return `<path d="M100 44 L82 82 L118 82 Z" fill="#E8476B"/>
    <path d="M100 44 L88 70 L100 74 Z" fill="#FFD166"/><circle cx="100" cy="41" r="6" fill="#FFD166"/>`;
  if (soort === "bril")      return `<g fill="none" stroke="#2A2733" stroke-width="3.5">
    <circle cx="80" cy="104" r="15"/><circle cx="120" cy="104" r="15"/><path d="M95 104 h10"/></g>`;
  if (soort === "zonnebril") return `<g fill="#2A2733"><rect x="63" y="95" width="32" height="20" rx="8"/>
    <rect x="105" y="95" width="32" height="20" rx="8"/><rect x="95" y="101" width="10" height="5"/></g>`;
  if (soort === "strik")     return `<g fill="#E8476B"><path d="M100 150 l-16 -9 v18 z"/><path d="M100 150 l16 -9 v18 z"/>
    <circle cx="100" cy="150" r="5"/></g>`;
  if (soort === "kroon")     return `<path d="M74 62 l8 -26 12 16 6 -22 6 22 12 -16 8 26 z" fill="#F2B21B" stroke="#C98F0C" stroke-width="2"/>
    <circle cx="86" cy="52" r="3" fill="#E8476B"/><circle cx="114" cy="52" r="3" fill="#4FA3E3"/>`;
  if (soort === "sjaal")     return `<path d="M64 148 q36 16 72 0 v14 q-36 16 -72 0 z" fill="#4FA3E3"/>`;
  if (soort === "das")       return `<path d="M100 146 l-9 8 9 24 9 -24 z" fill="#5B4BC4"/>`;
  return "";
}

function patroon(soort, v) {
  if (soort === "strepen") return `<g fill="${v.donker}" opacity=".85">
    <path d="M86 80 q6 11 0 20 q-5 -11 0 -20"/><path d="M100 76 q6 11 0 20 q-5 -11 0 -20"/>
    <path d="M114 80 q6 11 0 20 q-5 -11 0 -20"/></g>`;
  if (soort === "vlek")    return `<ellipse cx="128" cy="86" rx="20" ry="17" fill="${v.donker}" opacity=".8"/>`;
  if (soort === "smoking") return `<path d="M100 118 q-16 8 -16 30 q16 8 32 0 q0 -22 -16 -30" fill="${v.buik}"/>`;
  return "";
}

function tekenKat({ vacht, achtergrond, ogen, acc, pat }) {
  const v = VACHT[vacht];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200" role="img">
  <rect width="200" height="200" rx="28" fill="${achtergrond}"/>
  <ellipse cx="100" cy="176" rx="52" ry="12" fill="${v.donker}" opacity=".18"/>
  <path d="M58 110 C58 94 59 86 62 80 L57 52 L90 77 Q100 74 110 77 L143 52 L138 80
           C141 86 142 94 142 110 C142 140 125 152 100 152 C75 152 58 140 58 110 Z"
        fill="${v.basis}" stroke="${v.donker}" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M68 87 L65 62 L86 80 Z" fill="#F4A6B8"/><path d="M132 87 L135 62 L114 80 Z" fill="#F4A6B8"/>
  ${patroon(pat, v)}
  <ellipse cx="100" cy="128" rx="26" ry="18" fill="${v.buik}" opacity=".7"/>
  ${oog(ogen, 80, 104)}${oog(ogen, 120, 104)}
  <path d="M100 118 l-6 -5 h12 z" fill="#E8476B"/>
  <path d="M100 118 v6 M100 124 q-7 6 -13 1 M100 124 q7 6 13 1" stroke="#2A2733" stroke-width="2.6" fill="none" stroke-linecap="round"/>
  <g stroke="${v.donker}" stroke-width="2.2" stroke-linecap="round" opacity=".9">
    <path d="M62 116 h-18 M62 124 h-16 M138 116 h18 M138 124 h16"/></g>
  ${accessoire(acc)}
</svg>`;
}

// --- de catalogus ----------------------------------------------------
// gewoon: kale katten. bijzonder: met accessoire. zeldzaam: de bijzondere
// gevallen waar je even blij van wordt.
const KATTEN = [
  ["gewoon","Sok",        { vacht:"oranje",  ogen:"rond",   acc:"",          pat:"strepen" }],
  ["gewoon","Muis",       { vacht:"grijs",   ogen:"groot",  acc:"",          pat:"" }],
  ["gewoon","Drop",       { vacht:"zwart",   ogen:"groot",  acc:"",          pat:"" }],
  ["gewoon","Mist",       { vacht:"blauw",   ogen:"schuin", acc:"",          pat:"" }],
  ["gewoon","Pluis",      { vacht:"wit",     ogen:"rond",   acc:"",          pat:"vlek" }],
  ["gewoon","Koekje",     { vacht:"room",    ogen:"blij",   acc:"",          pat:"" }],
  ["gewoon","Streep",     { vacht:"cyperse", ogen:"rond",   acc:"",          pat:"strepen" }],
  ["gewoon","Vlek",       { vacht:"wit",     ogen:"schuin", acc:"",          pat:"vlek" }],
  ["gewoon","Roest",      { vacht:"rood",    ogen:"rond",   acc:"",          pat:"strepen" }],
  ["gewoon","Dut",        { vacht:"room",    ogen:"slaap",  acc:"",          pat:"" }],
  ["bijzonder","Professor",  { vacht:"grijs",   ogen:"rond",   acc:"bril",      pat:"" }],
  ["bijzonder","Feestbeest", { vacht:"oranje",  ogen:"blij",   acc:"feestmuts", pat:"strepen" }],
  ["bijzonder","Meneer Das", { vacht:"zwart",   ogen:"rond",   acc:"das",       pat:"smoking" }],
  ["bijzonder","Koolmees",   { vacht:"blauw",   ogen:"groot",  acc:"strik",     pat:"" }],
  ["bijzonder","Winter",     { vacht:"wit",     ogen:"blij",   acc:"sjaal",     pat:"" }],
  ["bijzonder","Chagrijn",   { vacht:"cyperse", ogen:"boos",   acc:"",          pat:"strepen" }],
  ["bijzonder","Cool",       { vacht:"zwart",   ogen:"rond",   acc:"zonnebril", pat:"" }],
  ["zeldzaam","Zijne Hoogheid", { vacht:"wit",    ogen:"schuin", acc:"kroon",     pat:"" }],
  ["zeldzaam","Nachtburgemeester", { vacht:"zwart", ogen:"boos", acc:"zonnebril", pat:"smoking" }],
  ["zeldzaam","Gouden Sok",     { vacht:"oranje", ogen:"groot",  acc:"kroon",     pat:"strepen" }]
];

fs.mkdirSync(UIT, { recursive: true });
let n = 0;
KATTEN.forEach(([rang, naam, opties], i) => {
  const svg = tekenKat({ ...opties, achtergrond: ACHTERGROND[i % ACHTERGROND.length] });
  const bestand = rang + "-" + naam.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".svg";
  fs.writeFileSync(path.join(UIT, bestand), svg);
  n++;
});
console.log(n + " katten getekend in app/cats/");
