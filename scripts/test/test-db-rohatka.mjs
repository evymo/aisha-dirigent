#!/usr/bin/env node
// =============================================================================
// test-db-rohatka.mjs — celá sada src/tests/db s rohatkou známých pádů
// =============================================================================
// Spouští se UVNITŘ zahazovací DB:  npm run test:db:rohatka
//   (= node scripts/db/with-throwaway-db.mjs -- node scripts/test/test-db-rohatka.mjs)
//
// Proč rohatka a proč tady: viz hlavička scripts/lib/rohatka-test-db.mjs.
//
// Soubory běží BEZ SOUBĚHU (`--no-file-parallelism`): sdílejí jednu DB. Naměřeno
// 2026-09-27: `wd-projekce-dvojcata` v souběhu viděl dva „objekty" místo jednoho
// a dva soubory schvalování pluginů si mazaly týž slug — výsledek podle pořadí.
//
// Verdikt dělá JSON report, ne návratový kód vitestu:
//   - report nevznikl                          → 75 NEZMĚŘENO (zopakovat);
//   - nový pád                                 → 1;
//   - v reportu chybí soubor sady              → 75 (tiché vynechání není zelená);
//   - soubor nedostal DB (povinný režim)       → 75 (sonda nepřeskočí potichu);
//   - vitest skončil ≠ 0 bez padlého testu:
//       „Timeout calling onTaskUpdate" (známý bug vitestu, viz run-vitest.mjs) → nevadí,
//       jinak → 75 (neošetřená chyba mimo test; důkaz o sadě chybí).
// Známé pády se jen ohlásí; opravené položky baseline se ohlásí „smaž z baseline".
// =============================================================================
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ENV_DB_POVINNA, MIMO_SADU, SADA, souboryDbSady, verdikt } from "../lib/rohatka-test-db.mjs";
import { KOD_NEZMERENO, KOD_ZELENA } from "./verdikt-kody.mjs";

const KOREN = process.cwd();
const BASELINE = path.join(KOREN, SADA, "test-db.baseline.json");
const reportDir = process.env.AISHA_REPORT_DIR ?? mkdtempSync(path.join(os.tmpdir(), "aisha-test-db-rohatka-"));
mkdirSync(reportDir, { recursive: true });
const REPORT = path.join(reportDir, "test-db-report.json");
const VERDIKT = path.join(reportDir, "test-db-rohatka.json");

if (!existsSync(BASELINE)) {
  console.error(`⛔ test-db-rohatka: chybí ${path.relative(KOREN, BASELINE)} — bez známých pádů nejde rozlišit nový pád.`);
  process.exit(KOD_NEZMERENO);
}
const znami = JSON.parse(readFileSync(BASELINE, "utf8")).pady ?? [];
const ocekavane = souboryDbSady(KOREN);

const args = [
  "vitest", "run", "--no-file-parallelism",
  "--reporter=default", "--reporter=json", `--outputFile.json=${REPORT}`,
  ...MIMO_SADU.flatMap((f) => ["--exclude", f]),
  `${SADA}/`,
];
console.log(`▶ test-db-rohatka: ${ocekavane.length} souborů, bez souběhu; mimo sadu: ${MIMO_SADU.join(", ")}`);

// Povinná DB: sonda testů nesmí nedostupnou DB tiše přeskočit (dutá zelená) —
// zkusí víckrát s delším stropem a pak soubor označí značkou → NEZMĚŘENO.
const vitest = spawn("npx", args, { stdio: ["inherit", "inherit", "pipe"], env: { ...process.env, [ENV_DB_POVINNA]: "1" } });
let stderr = "";
vitest.stderr.on("data", (b) => {
  process.stderr.write(b);
  stderr = (stderr + b.toString()).slice(-200_000);
});
const kodVitestu = await new Promise((res) => vitest.on("close", (c) => res(c ?? 1)));

let report = null;
if (existsSync(REPORT)) {
  try {
    report = JSON.parse(readFileSync(REPORT, "utf8"));
  } catch (e) {
    console.error(`⛔ report ${REPORT} nejde přečíst: ${e.message}`);
  }
}
let v = verdikt({ report, koren: KOREN, ocekavane, znami });
// Neošetřená chyba mimo test se do JSON reportu nedostane — pozná se jen z výstupu.
const jenTimeoutRpc = /Timeout calling .*onTaskUpdate/i.test(stderr);
const neosetrene = /Vitest caught \d+ unhandled error/i.test(stderr) && !jenTimeoutRpc;
if (v.kod === KOD_ZELENA && (neosetrene || (kodVitestu !== 0 && v.zname.length === 0 && !jenTimeoutRpc))) {
  v = { ...v, kod: KOD_NEZMERENO, duvod: `vitest skončil ${kodVitestu} s neošetřenou chybou mimo test — sada není celá změřená` };
}

writeFileSync(VERDIKT, JSON.stringify({ kod: v.kod, duvod: v.duvod, nove: v.nove, zname: v.zname, opravene: v.opravene, chybi: v.chybi }, null, 2));

console.log("\n────────────────────────────────────────────────────────────────────────");
console.log(`test-db-rohatka: ${v.duvod} (kód ${v.kod}) · známých pádů ${v.zname.length}/${znami.length} · verdikt ${VERDIKT}`);
if (v.zname.length) console.warn(`  známý dluh (baseline), neshazuje:\n    ${v.zname.join("\n    ")}`);
if (v.opravene.length) console.warn(`  OPRAVENO — smaž z ${path.relative(KOREN, BASELINE)}:\n    ${v.opravene.join("\n    ")}`);
if (v.chybi.length) console.error(`  ⛔ NEZMĚŘENO — v reportu chybí soubory sady:\n    ${v.chybi.join("\n    ")}`);
for (const jmeno of v.nove) {
  const zprava = (v.zpravy.get(jmeno) ?? "").split("\n").slice(0, 8).join("\n      ");
  console.error(`  ✗ NOVÝ PÁD: ${jmeno}\n      ${zprava}`);
  if (process.env.CI) console.log(`::error title=test-db-rohatka::nový pád ${jmeno.replace(/\n/g, " ")}`);
}
process.exit(v.kod);
