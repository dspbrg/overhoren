#!/usr/bin/env node
// Maakt de sha256-hash van een sync-code, voor het geheim ONBEPERKT van de
// worker (zie worker/README.md). De code wordt niet getoond en niet
// opgeslagen: typ of plak hem als het script erom vraagt (je ziet niets
// verschijnen), of geef hem via een pipe. Alleen de hash komt in beeld.
//
// Gebruik, vanuit de map van de repo:
//   node scripts/code-hash.mjs
//
// Nooit de code als argument meegeven: dan staat hij in de shellgeschiedenis.
import { createInterface } from "node:readline";
import { codeHash, geldigeCode } from "../worker/src/code.js";

if (process.argv.length > 2) {
  console.error("Geef de code niet als argument mee (dan staat hij in je shellgeschiedenis). Start zonder argumenten.");
  process.exit(2);
}

function leesStil(vraag) {
  return new Promise((klaar) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    if (process.stdin.isTTY) {
      process.stdout.write(vraag);
      // niets terugschrijven wat er getypt wordt
      rl._writeToOutput = () => {};
    }
    rl.question("", (antwoord) => { rl.close(); if (process.stdin.isTTY) process.stdout.write("\n"); klaar(antwoord); });
  });
}

// Zelfde vorm als in de app: kleine letters, streepjes tussen de delen.
function schoon(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/([a-z])([0-9])/g, "$1-$2").split(/[^a-z0-9]+/).filter(Boolean).join("-");
}

const code = schoon(await leesStil("Code (je ziet hem niet terwijl je typt): "));
if (!geldigeCode(code)) {
  console.error("Dat is geen geldige code. Een code is drie woorden en twee cijfers, zoals in het paneel van de app.");
  process.exit(1);
}
console.log(await codeHash(code));
