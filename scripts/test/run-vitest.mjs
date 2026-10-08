#!/usr/bin/env node
// =============================================================================
// run-vitest.mjs — Vitest spawner with RPC-timeout false-positive guard
// =============================================================================
// Známý vitest bug (issues/4744, /5260): "Timeout calling onTaskUpdate" během
// dlouhých test runů → vitest hlásí "Errors 1 error" + exit 1, **i když všechny
// testy prošly**. Worker RPC timeout je infrastruktura issue, ne test failure.
//
// Tento wrapper:
//   1. Pipuje stderr (stdout zůstává inherit pro live progres)
//   2. Po skončení vitestu detekuje pattern:
//        - vitest exit ≠ 0
//        - poslední řádek "Tests N passed (N)" (žádný "failed")
//        - error obsahuje "Timeout calling.*onTaskUpdate"
//      → override exit code na 0 (false positive)
//   3. Jinak passthrough exit code (real failures jdou nahoru)
//
// ⛔ TŘI STAVY, NE DVA. Wrapper vrací 0 (změřeno, zelené), 1 (změřeno, padlé)
// a KOD_NEZMERENO = 75 (NEZMĚŘENO: po běhu nezbyl důkaz). Viz komentář nad
// hlídačem postupu níž a `scripts/test/verdikt-kody.mjs`.
// =============================================================================
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KOD_NEZMERENO } from "./verdikt-kody.mjs";

const reportDir =
  process.env.AISHA_REPORT_DIR ??
  path.join(os.tmpdir(), "aisha-reports", "vitest");

// ─── Podlaha verze Node ──────────────────────────────────────────────────────
// ⛔ DRUHÁ VRSTVA, NE PRVNÍ. Tenhle soubor sám používá `??` a `?.`, takže pod
// Node 10 umře na SyntaxError DŘÍV, než se sem dostane — první vrstvu proto
// dělá `scripts/check-node.cjs` (schválně ES5) volaný z hooků. Tahle podlaha
// chytá verze, které se rozparsují, ale mají jiné ABI (14–20).
//
// NAMĚŘENO 2026-08-31: zastaralý PATH ukazoval na Node 10 z nvm; `npm run
// test:gates` skončil kódem 7 a NULOVÝM výstupem testů. Prázdný seznam selhání
// se dá přečíst jako zelená — a jednou se tak přečetl. Verze Node teď jde
// i do hlavičky běhu, aby šlo takový běh zpětně poznat.
const NODE_MAJOR = Number(process.versions.node.split(".")[0]);
if (NODE_MAJOR < 22) {
  process.stderr.write(
    `\n⛔ run-vitest: Node ${process.versions.node} — vyžaduje se >= 22 (.nvmrc).\n` +
      `   Sada by se buď nespustila, nebo běžela s jiným ABI. Spusť \`nvm use\`.\n\n`,
  );
  process.exit(9);
}

// ─── Pozicní argumenty se PROTÍNAJÍ, nesjednocují ────────────────────────────
// ⛔ NAMĚŘENO 2026-08-31 přes `vitest list`: `--default-dir src/tests/gates/`
// + `foo.gate.test.ts` vybere 1 soubor, kdežto dosavadní zápis (adresář jako
// pozicní arg z package.json + argument uživatele) vybral 628 — vitest bere
// pozicní vzory jako SJEDNOCENÍ. `npm run test:gates -- <soubor>` tedy
// nefiltroval, jen přidával; zdokumentováno i v .github/workflows/ci.yml.
//
// Nově: adresář se předává jako `--default-dir`. Bez pozicních argumentů se
// použije on; s nimi se použijí ONY a každý se ověří, že do adresáře patří —
// překlep v cestě je pak hlasitá chyba, ne tichý běh celé sady.
const rawArgs = process.argv.slice(2);
const defaultDirIdx = rawArgs.indexOf("--default-dir");
let defaultDir = null;
if (defaultDirIdx !== -1) {
  defaultDir = rawArgs[defaultDirIdx + 1];
  rawArgs.splice(defaultDirIdx, 2);
}
// ⛔ HODNOTA PŘEPÍNAČE NENÍ POZICNÍ ARGUMENT. `--config vitest.gates.config.ts`
// vypadá po naivním filtru `!a.startsWith("-")` jako cesta k testu — a první
// verze téhle stráže na tom rovnou spadla (naměřeno 2026-08-31: odmítla
// `vitest.gates.config.ts` jako „cestu mimo adresář"). Token se počítá jako
// pozicní jen tehdy, když PŘEDCHOZÍ token není přepínač čekající hodnotu;
// tvar `--config=x` hodnotu nese v sobě, takže za ním pozicní být může.
const positionals = rawArgs.filter((a, i) => {
  if (a.startsWith("-")) return false;
  const pred = i > 0 ? rawArgs[i - 1] : "";
  return !(pred.startsWith("-") && !pred.includes("="));
});
if (defaultDir) {
  if (positionals.length === 0) {
    rawArgs.push(defaultDir);
  } else {
    const mimo = positionals.filter((p) => !path.resolve(p).startsWith(path.resolve(defaultDir)));
    if (mimo.length) {
      process.stderr.write(
        `\n⛔ run-vitest: cesta mimo ${defaultDir}: ${mimo.join(", ")}\n` +
          `   Tenhle běh je vymezen na ${defaultDir}; cesta jinam by tiše rozšířila rozsah.\n\n`,
      );
      process.exit(2);
    }
  }
}

// ⛔ VSTUPNÍ BOD VÝHRADNĚ PRO SONDY. Hlídač zamrznutí se skutečným vitestem
// poctivě ověřit nedá: zamrznutí se nedá objednat a sonda by trvala minuty.
// `AISHA_VITEST_CMD` je JSON pole argv, kterým sonda podstrčí falešný běh
// (mlčící, zamrzlý, s reportem i bez něj). V provozu se NENASTAVUJE — bez něj
// wrapper spouští `npx vitest run` úplně stejně jako dosud.
let cmd = "npx";
let args = ["vitest", "run", ...rawArgs];
if (process.env.AISHA_VITEST_CMD) {
  let sonda = null;
  try {
    sonda = JSON.parse(process.env.AISHA_VITEST_CMD);
  } catch {
    /* níž se zahlásí jako neplatné */
  }
  if (!Array.isArray(sonda) || sonda.length === 0 || sonda.some((a) => typeof a !== "string")) {
    process.stderr.write(
      "\n⛔ run-vitest: AISHA_VITEST_CMD musí být neprázdné JSON pole řetězců (argv sondy).\n\n",
    );
    process.exit(2);
  }
  cmd = sonda[0];
  args = [...sonda.slice(1), ...rawArgs];
}

// Capture both stdout (vitest summary "Tests N passed") and stderr (RPC error)
// while preserving live output. Detection of false positive requires both streams.
let stdoutBuf = "";
let stderrBuf = "";
const child = spawn(cmd, args, {
  stdio: ["inherit", "pipe", "pipe"],
  env: {
    ...process.env,
    AISHA_REPORT_DIR: reportDir,
  },
});

// ── Teardown watchdog ────────────────────────────────────────────────────────
// Second manifestation of the same vitest worker-RPC bug: instead of exiting 1
// after the run, vitest sometimes NEVER exits — a worker keeps the event loop
// alive after the final summary. The exit-handler tolerance below then never
// runs, and outer step budgets (stack-smoke's 600s offline ceiling, CI job
// timeouts) kill the whole step as a failure even though every test passed
// (observed 2026-07-10: four consecutive pre-push runs died this way).
// Once the final summary ("Tests … (N)" + "Duration …") is on stdout, give the
// process a grace period to exit on its own; after that, evaluate the SAME
// green-criteria as the exit handler and force-conclude. Real failures still
// propagate as exit 1 — only the process lifecycle is being repaired here.
const TEARDOWN_GRACE_MS = 90_000;
let teardownTimer = null;

// ── HLÍDAČ POSTUPU (ne ticha) ────────────────────────────────────────────────
// ⛔ MLČENÍ NENÍ MĚŘENÍ — ANI ZELENÉ, ANI ČERVENÉ. Předchozí hlídač měřil ČAS
// BEZ VÝSTUPU: po 180 s běh zabil a když nenašel report, uzavřel ho jako FAIL.
// Dvě chyby v jedné:
//   (1) uplynulý čas není důkaz o běhu — stroj, který mezitím spal, vypadá
//       úplně stejně jako zamrzlý worker;
//   (2) „nevím, jak to dopadlo" se hlásilo jako „testy selhaly", takže poctivý
//       pád a chybějící důkaz nešly rozeznat ani v CI, ani v hooku.
//
// ⛔ NAMĚŘENO 2026-09-20 na úloze „Web: Tests" (4 647 řádků logu, 30 min běhu):
// nejdelší ticho v celém běhu bylo 55 s a nikdy nepřesáhlo 60 s. Práh 180 s
// tedy nechytal pomalé brány — chytal běhy BEZ POSTUPU. Sledovat rovnou postup
// je tedy nejen poctivější, ale i přesnější.
//
// Postupem je kterýkoli DŮKAZ, že se běh hýbe:
//   · bajt na stdout/stderr (jako dosud),
//   · pohyb artefaktu běhu — `gates-test-progress.json` (tep reportéru, píše se
//     průběžně) nebo `gates-test-report.json` (závěr).
// Když se po STALL_MS nehne ANI JEDEN, hlídač neuzavírá běh podle času, ale
// sáhne po důkazu: REPORT → souhrn na obrazovce → NEZMĚŘENO.
const STALL_MS = Number(process.env.AISHA_STALL_MS ?? 180_000);
const POLL_MS = Math.max(200, Math.min(5_000, Math.floor(STALL_MS / 6)));

// ⛔ SPÍCÍ STROJ NENÍ ZAMRZLÝ BĚH. Když se hostitel uspí (zavřené víko) nebo
// proces dostane SIGSTOP, časovače se nevykonají a `Date.now()` po probuzení
// SKOČÍ. Rozdíl mezi dvěma tiky hlídače je tedy měřitelný důkaz, že stál ČAS
// NÁM, ne běh — takový skok se nesmí započítat do ticha, jinak hlídač zabije
// zdravý běh hned po probuzení. (Táž třída jako spící držitel slotu ve frontě
// těžkých úloh: nepřítomnost se nesmí číst ani jako život, ani jako smrt.)
const SUSPEND_JUMP_MS = Number(process.env.AISHA_SUSPEND_JUMP_MS ?? 60_000);

let lastProgressMs = Date.now();
let lastTickMs = Date.now();
let lastArtifactFp = artifactFingerprint();
let hlidac = null;

/** Otisk artefaktů běhu; jakákoli změna = běh se hýbe. */
function artifactFingerprint() {
  return reportDirs()
    .flatMap((d) => ["gates-test-report.json", "gates-test-progress.json"].map((n) => path.join(d, n)))
    .map((p) => {
      try {
        const st = fs.statSync(p);
        return `${p}@${st.mtimeMs}:${st.size}`;
      } catch {
        return `${p}@-`;
      }
    })
    .join("|");
}

function zaznamenejPostup() {
  lastProgressMs = Date.now();
}

function startProgressWatchdog() {
  hlidac = setInterval(() => {
    const ted = Date.now();
    const tik = ted - lastTickMs;
    lastTickMs = ted;

    if (tik > SUSPEND_JUMP_MS) {
      process.stderr.write(
        `\n[run-vitest] skok v čase ${Math.round(tik / 1000)} s mezi tiky hlídače — stroj spal ` +
          "nebo byl proces pozastaven. Okno postupu se počítá znovu; tohle není ticho běhu.\n",
      );
      lastProgressMs = ted;
      lastArtifactFp = artifactFingerprint();
      return;
    }

    const fp = artifactFingerprint();
    if (fp !== lastArtifactFp) {
      lastArtifactFp = fp;
      lastProgressMs = ted;
      return;
    }

    if (ted - lastProgressMs < STALL_MS) return;

    process.stderr.write(
      `\n[run-vitest] ${Math.round((ted - lastProgressMs) / 1000)} s BEZ POSTUPU — ani řádek výstupu, ` +
        "ani pohyb reportu. Běh je zamrzlý; verdikt se bere z důkazů, ne z uplynulého času.\n",
    );
    uzavriPodleDukazu("zamrznutí před závěrečným souhrnem");
  }, POLL_MS);
  hlidac.unref?.();
}

// ── UZAVŘENÍ PODLE DŮKAZŮ ────────────────────────────────────────────────────
// Pořadí zdrojů je dané jejich spolehlivostí:
//   1. REPORT z tohoto běhu — autorita, vzniká PO doběhnutí testů,
//   2. souhrn na obrazovce — nouze, je určený člověku a při zamrznutí chybí,
//   3. nic → NEZMĚŘENO. Ne FAIL: nevíme, jak testy dopadly, a vymyslet si to
//      nesmíme ani jedním směrem. Zelenou z mlčení nevyrábíme — červenou taky ne.
function uzavriPodleDukazu(duvod) {
  if (hlidac) clearInterval(hlidac);
  if (teardownTimer) clearTimeout(teardownTimer);
  const rep = verdictFromReport();
  const { allPassed, someFailed, noTestFilesFailed } = evaluateBuffers();
  try {
    child.kill("SIGKILL");
  } catch {
    /* už je pryč */
  }

  if (rep.found) {
    process.stderr.write(
      `[run-vitest] verdikt z REPORTU ${rep.path}: ${rep.summary.totalTests} testů, ` +
        `${rep.summary.failed} padlých → ${rep.green ? "PASS" : "FAIL"} (${duvod}).\n`,
    );
    process.exit(rep.green ? 0 : 1);
  }

  if (someFailed) {
    process.stderr.write(
      `[run-vitest] report z tohoto běhu neexistuje, ale na obrazovce JSOU padlé testy → FAIL (${duvod}).\n`,
    );
    process.exit(1);
  }

  if (allPassed && noTestFilesFailed) {
    process.stderr.write(
      `[run-vitest] report z tohoto běhu neexistuje; závěrečný souhrn na obrazovce je zelený → PASS (${duvod}).\n`,
    );
    process.exit(0);
  }

  process.stderr.write(
    `[run-vitest] NEZMĚŘENO (kód ${KOD_NEZMERENO}): po běhu nezbyl ŽÁDNÝ důkaz — report z tohoto běhu\n` +
      "[run-vitest] neexistuje a závěrečný souhrn se nevypsal. NENÍ to selhání testů: nevíme, jak\n" +
      "[run-vitest] dopadly. Běh zopakuj. Když se to opakuje, příčina je v zamrznutí (osiřelí\n" +
      "[run-vitest] workeři, plný disk, zabitý worker), ne v branách — hledej ji tam.\n",
  );
  process.exit(KOD_NEZMERENO);
}

// ── BARVY V BUFFERU ──────────────────────────────────────────────────────────
// ⛔ NAMĚŘENO 2026-09-20 v CI (úloha „Web: Tests", běh 50075): vitest BARVÍ i do
// roury, takže na obrazovce je `Tests  551 passed`, ale v bufferu stojí
// `Tests <ESC>[22m <ESC>[1m<ESC>[32m551 passed`. Vzor `/Tests\s+\d+/` na tom
// neuspěje — mezi slovem a číslem nejsou mezery, ale escape sekvence.
//
// Důsledek nebyl kosmetický: PRÁVĚ TÍMHLE byla v CI po celou dobu MRTVÁ hlavní
// funkce tohohle wrapperu — tolerance falešného pádu při RPC timeoutu se
// opírá o týž vzor, takže v barveném výstupu nemohla zabrat nikdy. Vyplavilo
// se to až na nové stráži „nula bez měření", která běží po KAŽDÉM běhu:
// zelený běh (551 testů, kód 0) se uzavřel jako NEZMĚŘENO.
//
// Text se proto před každým měřením očistí. Barvy jdou na obrazovku beze změny,
// rozhoduje se nad čistým textem.
const KODY_BAREV = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*[A-Za-z]", "g");
function bezBarev(text) {
  return text.replace(KODY_BAREV, "");
}

function evaluateBuffers() {
  const combinedBuf = bezBarev(stdoutBuf + "\n" + stderrBuf);
  const allPassed = /Tests\s+\d+\s+passed.*?\(\d+\)/m.test(combinedBuf)
    && !/Tests\s+\d+\s+failed/i.test(combinedBuf);
  const noTestFilesFailed = !/Test Files\s+\d+\s+failed/i.test(combinedBuf);
  // ⛔ PÁD JE TAKY MĚŘENÍ. Zamrzlý běh, po kterém na obrazovce zůstaly řádky
  // `× cesta > test`, NENÍ nezměřený: víme jistě, že aspoň jedna brána spadla.
  // Bez tohohle rozlišení by se takový běh uzavřel jako NEZMĚŘENO a padlá
  // brána by se schovala za „zopakuj běh".
  const someFailed = /Tests\s+\d+\s+failed/i.test(combinedBuf)
    || /Test Files\s+\d+\s+failed/i.test(combinedBuf)
    || /(^|\n)\s*×\s+\S/.test(combinedBuf);
  return { allPassed, someFailed, noTestFilesFailed };
}

// ── VERDIKT Z REPORTU, NE Z OBRAZOVKY ────────────────────────────────────────
// Parsování stdoutu je nouzová cesta: souhrn je určený ČLOVĚKU a při zamrznutí
// před koncem se nevypíše vůbec. Reportér ale píše `gates-test-report.json`
// v `onFinished`, tedy PO doběhnutí všech testů a PŘED zamrznutím teardownu —
// je to tedy autorita, která existuje právě v tom okamžiku, kdy obrazovka mlčí.
//
// Report se bere jen tehdy, když vznikl PO STARTU tohoto běhu; starší soubor
// z minulého běhu by jinak prohlásil za zelený běh, který se ani nerozjel.
// (Táž třída jako „prázdná množina není čistý strom": nesmí se stát, že mlčení
// nebo cizí artefakt vyrobí zelenou.)
const RUN_START_MS = Date.now();

/** Oba domovy artefaktů běhu; hlídač i verdikt musí koukat na TOTÉŽ. */
function reportDirs() {
  return [path.join(process.cwd(), "docs", "db-structure"), reportDir];
}

function verdictFromReport() {
  const kandidati = reportDirs().map((d) => path.join(d, "gates-test-report.json"));
  for (const p of kandidati) {
    try {
      const st = fs.statSync(p);
      if (st.mtimeMs < RUN_START_MS) continue;      // report je z JINÉHO běhu
      const r = JSON.parse(fs.readFileSync(p, "utf-8"));
      const s = r?.summary;
      if (!s || typeof s.failed !== "number" || typeof s.totalTests !== "number") continue;
      return { found: true, green: s.failed === 0 && s.totalTests > 0, path: p, summary: s };
    } catch { /* další kandidát */ }
  }
  return { found: false, green: false, path: null, summary: null };
}

function armTeardownWatchdog() {
  if (teardownTimer) return;
  teardownTimer = setTimeout(() => {
    process.stderr.write(
      `\n[run-vitest] vitest neskončil do ${TEARDOWN_GRACE_MS / 1000} s po závěrečném souhrnu ` +
      "(zamrzlý teardown workeru) — uzavírám podle důkazů.\n"
    );
    uzavriPodleDukazu("zamrzlý teardown po souhrnu");
  }, TEARDOWN_GRACE_MS);
}

child.stdout.on("data", (chunk) => {
  const s = chunk.toString();
  stdoutBuf += s;
  process.stdout.write(s);
  zaznamenejPostup();
  if (/Duration\s+[\d.]+m?s/.test(stdoutBuf) && /Tests\s+\d+\s+passed.*?\(\d+\)/m.test(stdoutBuf)) {
    armTeardownWatchdog();
  }
});

child.stderr.on("data", (chunk) => {
  const s = chunk.toString();
  stderrBuf += s;
  process.stderr.write(s);
  zaznamenejPostup();
});

// Ozbrojit hned po startu: zamrznout může i běh, který nevypíše VŮBEC NIC.
startProgressWatchdog();

child.on("exit", (code, signal) => {
  if (hlidac) clearInterval(hlidac);
  if (teardownTimer) clearTimeout(teardownTimer);
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  // RPC timeout false-positive override.
  // Vitest summary ("Tests N passed") goes to STDOUT; RPC error goes to STDERR.
  // Pattern indicators (kombinace stdout+stderr):
  //   stdout: "Tests  N passed (N)" + žádný "failed" → all tests passed
  //   stderr: "Timeout calling.*onTaskUpdate"        → worker RPC issue, ne fail
  if (code !== 0) {
    const combinedBuf = bezBarev(stdoutBuf + "\n" + stderrBuf);
    // Note: vitest summary may include "| N skipped" between "passed" and "(N)",
    // e.g. "Tests  1753 passed | 2 skipped (1755)". Use .*? to bridge the gap.
    const allPassed = /Tests\s+\d+\s+passed.*?\(\d+\)/m.test(combinedBuf)
      && !/Tests\s+\d+\s+failed/i.test(combinedBuf);
    const isRpcTimeout = /Timeout calling .*onTaskUpdate/i.test(combinedBuf);
    const noTestFilesFailed = !/Test Files\s+\d+\s+failed/i.test(combinedBuf);
    if (allPassed && isRpcTimeout && noTestFilesFailed) {
      process.stderr.write(
        "\n[run-vitest] All tests passed; ignoring vitest RPC-timeout false positive (exit 1 → 0).\n"
      );
      process.exit(0);
    }
  }

  // ⛔ ZELENÝ KÓD BEZ MĚŘENÍ NENÍ ZELENÁ. Naměřeno 2026-08-31: zastaralý PATH
  // ukazoval na jiný Node a sada skončila s NULOVÝM výstupem testů — prázdný
  // seznam selhání se čte jako zelená a jednou se tak přečetl. Když po běhu
  // nezbyl ani report, ani závěrečný souhrn, nemáme co prohlásit za zelené.
  if (code === 0) {
    const rep = verdictFromReport();
    const videnSouhrn = /Tests\s+\d+\s+(passed|failed)/i.test(bezBarev(stdoutBuf + "\n" + stderrBuf));
    if (!rep.found && !videnSouhrn) {
      process.stderr.write(
        `\n[run-vitest] NEZMĚŘENO (kód ${KOD_NEZMERENO}): běh skončil nulou, ale nezanechal důkaz —\n` +
          "[run-vitest] žádný report z tohoto běhu a žádný závěrečný souhrn. Nula bez měření není zelená.\n",
      );
      process.exit(KOD_NEZMERENO);
    }
  }

  process.exit(code ?? 1);
});
