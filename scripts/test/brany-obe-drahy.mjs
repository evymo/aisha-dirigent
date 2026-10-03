#!/usr/bin/env node
// =============================================================================
// brany-obe-drahy.mjs — pustí OBĚ dráhy a teprve pak řekne verdikt
// =============================================================================
// ⛔ PROČ NE `light && heavy`
// Řetězení přes `&&` ZKRATUJE: když selže lehká dráha, těžká se vůbec nespustí.
// Před rozdělením na dráhy dal jeden běh VŠECHNA selhání najednou; s `&&` by
// se dozvíte jen ta z lehké a po opravě byste běželi znovu, abyste našli
// zbytek. To je přesně ta smyčka „oprav jednu věc, spusť, oprav další", která
// dnes čtyřikrát zamítla push — jen o patro níž.
//
// Tenhle skript proto pustí obě dráhy VŽDY a vrátí nenulový kód, pokud selhala
// kterákoli. Rozdělení má být neviditelné: `npm run test:gates` má odpovídat
// na touž otázku jako dřív, jen levněji.
//
// Souhrn na konci je jediné místo, kde se sečtou obě dráhy — jinak by se
// „624 prošlo" a „9 prošlo" četlo jako dvě nesouvisející zprávy.
// =============================================================================
import { spawnSync } from "node:child_process";
import { readFileSync, statSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { KOD_NEZMERENO, popisDrahy } from "./verdikt-kody.mjs";

const ROOT = process.cwd();

// ⛔ REPORT MÁ DVA MOŽNÉ DOMOVY a bere se jen ČERSTVÝ. Reportér píše buď do
// `docs/db-structure/`, nebo do `AISHA_REPORT_DIR` (výchozí pod tmp) — první
// verze tohohle skriptu četla natvrdo jen ten první a hlásila „72 testů" místo
// sedmi tisíc, protože sáhla na cizí soubor. Stáří se kontroluje ze stejného
// důvodu, jaký má `run-vitest.mjs`: starý report by prohlásil za zelený běh,
// který se ani nerozjel. Logika je odtud převzatá, ne vymyšlená podruhé.
/** Přečte verdikt z artefaktu, ne ze stdout — stdout se dá ztratit, soubor ne. */
function precetVerdikt(adresar, odKdy) {
  for (const cesta of [path.join(adresar, "gates-test-report.json")]) {
    try {
      if (statSync(cesta).mtimeMs < odKdy) continue; // report z JINÉHO běhu
      const d = JSON.parse(readFileSync(cesta, "utf-8"));
      return {
        testu: d.summary?.totalTests ?? 0,
        proslo: d.summary?.passed ?? 0,
        selhalo: d.summary?.failed ?? 0,
        preskoceno: d.summary?.skipped ?? 0,
        preskoceneSoubory: d.summary?.skippedFiles ?? [],
        node: d.node ?? "?",
      };
    } catch (e) {
      // Nepřečtený kandidát není verdikt; zkusíme další. O zelené rozhoduje
      // návratový kód běhu, ne to, jestli se povedlo přečíst souhrn.
      if (e?.code !== "ENOENT") {
        process.stderr.write(
          `  (report ${path.basename(cesta)}: ${String(e.message).split("\n")[0]})\n`,
        );
      }
    }
  }
  return null;
}

function drahu(jmeno, lane) {
  process.stderr.write(`\n━━━ dráha: ${jmeno} ━━━\n`);
  const zacatek = Date.now();
  // ⛔ KAŽDÁ DRÁHA MÁ VLASTNÍ REPORT. Sdílený soubor má DVA zapisovatele a
  // souhrn z něj čte nespolehlivě: naměřeno 2026-08-31, že součet vyšel 14 259
  // místo 7 225, protože se sáhlo na cizí zápis. Táž třída jako všechny dnešní
  // nálezy o dvou zapisovatelích jedné pravdy — jen tady jsem ji vyrobil sám.
  const adresar = mkdtempSync(path.join(os.tmpdir(), `aisha-drahy-${lane}-`));
  const r = spawnSync(
    "node",
    [
      "scripts/test/run-vitest.mjs",
      "--config",
      "vitest.gates.config.ts",
      "--default-dir",
      "src/tests/gates/",
    ],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        AISHA_SKIP_ONLINE: "1",
        AISHA_GATES_LANE: lane,
        AISHA_REPORT_DIR: adresar,
      },
    },
  );
  return { kod: r.status ?? 1, verdikt: precetVerdikt(adresar, zacatek) };
}

const lehka = drahu("lehká (rychlé brány, poctivý timeout 30 s)", "light");
const tezka = drahu("těžká (naměřené žrouty, 3 workeři)", "heavy");

const soucet = (k) =>
  (lehka.verdikt?.[k] ?? 0) + (tezka.verdikt?.[k] ?? 0);
const preskoceneSoubory = [
  ...(lehka.verdikt?.preskoceneSoubory ?? []),
  ...(tezka.verdikt?.preskoceneSoubory ?? []),
];

process.stderr.write("\n━━━ souhrn obou drah ━━━\n");
process.stderr.write(
  `  testů ${soucet("testu")} · prošlo ${soucet("proslo")} · ` +
    `selhalo ${soucet("selhalo")} · přeskočeno ${soucet("preskoceno")}\n`,
);
process.stderr.write(`  node ${lehka.verdikt?.node ?? process.versions.node}\n`);
if (preskoceneSoubory.length > 0) {
  // ⛔ PŘESKOČENO NENÍ PROŠLO. Bez jmenného seznamu se soubor, který neověřil
  // nic, nedá odlišit od souboru, který ověřil všechno.
  process.stderr.write(`  přeskočeno v ${preskoceneSoubory.length} souborech:\n`);
  for (const s of preskoceneSoubory) process.stderr.write(`    ${s.file} (${s.skipped})\n`);
}

// ⛔ NEZMĚŘENÁ DRÁHA SE NESMÍ SEČÍST JAKO NULA — ANI SE VYDÁVAT ZA PÁD.
// `precetVerdikt` vrací null, když report dráhy nevznikl; součet výš pak takovou
// dráhu přičetl jako „0 testů, 0 selhání" a výsledek se četl jako měření.
// Prázdno není nula. A návratový kód se dosud plošně srovnal na 1, takže se
// zamrznutí bez důkazu nedalo odlišit od poctivě padlé brány: první se má
// ZOPAKOVAT, druhá OPRAVIT. Od teď jsou to dva různé kódy (viz verdikt-kody.mjs).
const nezmerene = [
  ["lehká", lehka],
  ["těžká", tezka],
].filter(([, d]) => d.kod === KOD_NEZMERENO || (d.kod === 0 && d.verdikt === null));
if (nezmerene.length > 0) {
  process.stderr.write(
    `  ⛔ NEZMĚŘENO: ${nezmerene.map(([j]) => j).join(", ")} — report z běhu nevznikl,\n` +
      "     součty výš jsou tedy NEÚPLNÉ (ne malé). Testy mohly projít i spadnout.\n",
  );
}

const skutecnePady = [lehka.kod, tezka.kod].filter((k) => k !== 0 && k !== KOD_NEZMERENO);
const kod = skutecnePady.length > 0 ? 1 : nezmerene.length > 0 ? KOD_NEZMERENO : 0;
process.stderr.write(
  kod === 0
    ? "  verdikt: OBĚ DRÁHY ZELENÉ\n\n"
    : kod === KOD_NEZMERENO
      ? `  verdikt: NEZMĚŘENO — lehká ${popisDrahy(lehka.kod)}, těžká ${popisDrahy(tezka.kod)}; ` +
        "běh zopakuj, tohle není padlá brána\n\n"
      : `  verdikt: SELHÁNÍ — lehká ${popisDrahy(lehka.kod)}, těžká ${popisDrahy(tezka.kod)}\n\n`,
);
process.exit(kod);
