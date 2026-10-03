#!/usr/bin/env node
// =============================================================================
// sonda-behu.mjs — falešný běh testů pro sondy hlídače v run-vitest.mjs
// =============================================================================
// ⛔ ZAMRZNUTÍ SE NEDÁ OBJEDNAT. Hlídač postupu se skutečným vitestem poctivě
// ověřit nejde: běh trvá minuty a zamrznout si na povel neumí. Tenhle skript
// je proto NÁHRADNÍ BĚH — umí přesně ty tvary, na kterých hlídač stojí:
// mlčet napořád, mlčet a přitom hýbat reportem, nechat po sobě zelený nebo
// červený report, nebo skončit nulou a nenechat po sobě vůbec nic.
//
// Spouští se jen přes `AISHA_VITEST_CMD` ze sondy; v provozu ho nikdo nevolá.
// Není to `*.test.mjs`, takže ho vitest sám neposbírá.
// =============================================================================
import fs from "node:fs";
import path from "node:path";

// ⛔ ŽÁDNÝ FALLBACK NAD ENV (pravidlo majitele, brána zadny-fallback-nad-identitou).
// Dosazené „ticho" by znamenalo, že sonda se špatně předaným režimem TIŠE měří
// něco jiného, než si myslí — a to je přesně ta třída vad, kterou celý tenhle
// PR řeší: běh, který vypadá jako měření, ale měří jinou věc. Chybějící hodnota
// proto padá nahlas a hned.
const rezim = process.env.SONDA_REZIM;
if (!rezim) {
  process.stderr.write("sonda: chybí SONDA_REZIM — režim náhradního běhu doručuje sonda, nehádá se\n");
  process.exit(3);
}
const adresar = process.env.AISHA_REPORT_DIR;
if (!adresar) {
  process.stderr.write("sonda: chybí AISHA_REPORT_DIR (doručuje ho wrapper)\n");
  process.exit(3);
}
const cestaReport = path.join(adresar, "gates-test-report.json");
const cestaTep = path.join(adresar, "gates-test-progress.json");
// Táž úvaha jako u režimu: délku běhu určuje sonda, fixtura si ji nevymýšlí.
const trvani = Number(process.env.SONDA_TRVANI_MS);

function zapisReport(padlych) {
  fs.mkdirSync(adresar, { recursive: true });
  fs.writeFileSync(
    cestaReport,
    JSON.stringify({
      timestamp: new Date().toISOString(),
      node: process.versions.node,
      summary: {
        totalFiles: 1,
        totalTests: 7,
        passed: 7 - padlych,
        failed: padlych,
        skipped: 0,
        skippedFiles: [],
        duration: 1,
        suites: {},
      },
      issues: [],
    }) + "\n",
  );
}

function zapisTep(i) {
  fs.mkdirSync(adresar, { recursive: true });
  fs.writeFileSync(
    cestaTep,
    JSON.stringify({ stav: "běží", zmenUloh: i, updatedAt: new Date().toISOString() }) + "\n",
  );
}

/** Závěrečný souhrn vitestu tak, jak doopravdy vypadá v CI — s barvami. */
function barevnySouhrn() {
  const E = String.fromCharCode(27);
  return (
    `${E}[2m Test Files ${E}[22m ${E}[1m${E}[32m49 passed${E}[39m${E}[22m${E}[90m (60)${E}[39m\n` +
    `${E}[2m      Tests ${E}[22m ${E}[1m${E}[32m551 passed${E}[39m${E}[22m${E}[2m | ${E}[22m` +
    `${E}[33m54 skipped${E}[39m${E}[90m (605)${E}[39m\n`
  );
}

/** Drží proces naživu, aniž by cokoli dělal — to je přesně zamrznutí. */
function nikdyNeskonci() {
  setInterval(() => {}, 1_000);
}

switch (rezim) {
  case "ticho":
    process.stdout.write("sonda: start, dál už ani slovo\n");
    nikdyNeskonci();
    break;

  case "report-zeleny":
    zapisReport(0);
    process.stdout.write("sonda: report zapsán, teď zamrzám\n");
    nikdyNeskonci();
    break;

  case "report-cerveny":
    zapisReport(2);
    process.stdout.write("sonda: report zapsán, teď zamrzám\n");
    nikdyNeskonci();
    break;

  case "tep": {
    if (!Number.isFinite(trvani) || trvani <= 0) {
      process.stderr.write("sonda: režim tep vyžaduje SONDA_TRVANI_MS\n");
      process.exit(3);
    }
    // Mlčí na stdout DÉL než okno hlídače, ale artefakt se hýbe → je to postup.
    let i = 0;
    const tik = setInterval(() => zapisTep(++i), 250);
    setTimeout(() => {
      clearInterval(tik);
      zapisReport(0);
      process.exit(0);
    }, trvani);
    break;
  }

  case "spanek": {
    // Mlčí a nehýbe ničím; sonda mezitím uspí SAMOTNÝ WRAPPER (SIGSTOP).
    //
    // ⛔ ČEKÁ SE NA POKYN, NE NA ČAS. Kdyby tenhle režim dopsal report po pevné
    // době, sonda by měřila závod mezi dvěma časovači — a pod zátěží (naměřeno
    // dnes: load 74) by prohrál jednou tak, podruhé onak. Fixtura proto čeká na
    // soubor `pokracuj`, který sonda založí AŽ PO probuzení wrapperu: pořadí je
    // pak dané, ne pravděpodobné.
    const pokyn = path.join(adresar, "pokracuj");
    const strop = Date.now() + 60_000; // pojistka, ať nezůstane viset navěky
    const cekej = setInterval(() => {
      if (fs.existsSync(pokyn)) {
        clearInterval(cekej);
        zapisReport(0);
        process.exit(0);
      }
      if (Date.now() > strop) {
        clearInterval(cekej);
        process.stderr.write("sonda: pokyn nepřišel do 60 s\n");
        process.exit(3);
      }
    }, 100);
    break;
  }

  case "barevny-souhrn": {
    // ⛔ TAKHLE TO CHODÍ Z CI. Vitest barví i do roury, takže mezi „Tests" a
    // číslem NEJSOU mezery, ale escape sekvence. Zkopírováno z ostrého logu
    // (běh 50075, úloha „Web: Tests"), kde se kvůli tomu zelený běh uzavřel
    // jako NEZMĚŘENO.
    process.stdout.write(barevnySouhrn());
    process.exit(0);
  }

  case "rpc-timeout": {
    // Známý bug vitestu: všechny testy prošly, ale worker nestihl nahlásit
    // výsledky → exit 1. Kvůli tomu tenhle wrapper vůbec vznikl; v barveném
    // výstupu ale ta tolerance nemohla zabrat, takže sonda hlídá i ji.
    process.stdout.write(barevnySouhrn());
    process.stderr.write('Error: Timeout calling "onTaskUpdate"\n');
    process.exit(1);
  }

  case "nula-bez-mereni":
    // Skončí nulou a nenechá po sobě ani report, ani souhrn na obrazovce.
    process.exit(0);
    break;

  default:
    process.stderr.write(`sonda: neznámý režim ${rezim}\n`);
    process.exit(3);
}
