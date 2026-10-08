#!/usr/bin/env node
/**
 * AISHA stack smoke runner
 * ========================
 *
 * Single entry-point for "did I break anything?" — runs in three phases
 * so operators (us, Acme, law firms, accounting offices, …) can validate
 * a stack instance without depending on any cloud key.
 *
 *   PHASE 1 — Preflight
 *     - git submodule update --init (insight / vendored deps)
 *     - npm run db-mgr:source if `docs/db-structure/source-truth-report.json`
 *       is missing
 *
 *   PHASE 2 — Offline (no keys, no stack)
 *     A "did anything regress?" gate that doesn't touch the network or
 *     the DB. Same checks pre-push runs — so if `test:stack:ci` is green,
 *     `git push` would be green for the same reason.
 *
 *     - npx tsc --noEmit                 (type system)
 *     - npm run lint                     (eslint)
 *     - npm run test:gates               (~2500 contract/gate tests)
 *     - npm run validate:static          (SQL function static validation)
 *     - npm run i18n:check               (i18n key coverage)
 *     - npm run test:run                 (~5400 unit tests)
 *     - npm run test:services            (per-microservice unit tests)
 *     - npm run build                    (production bundle; SKIPPED by
 *                                          AISHA_SMOKE_SKIP_BUILD=1 in CI fast lanes)
 *
 *   PHASE 3 — Warmup smoke (DETECTED backend)
 *     - Detect which LLM backend the operator wired into env
 *       (mock / Ollama / vLLM / Docker Model Runner / Maestro /
 *        AISHA LLM Gateway / OpenAI / Anthropic / Google).
 *     - Detect whether PostgREST + svc-web-artifact + n8n are reachable.
 *     - If a backend is configured AND services are reachable:
 *         curl /functions/v1/ai-generate (echo prompt, expect mock or
 *         the resolved provider's response shape)
 *         curl /functions/v1/web-artifact-seed-default (idempotent, 304 on
 *         repeat — proves the whole web_artifact pipeline end-to-end)
 *     - If anything is missing, skip with a clear reason — never fail.
 *
 * Output is a single-line summary per phase plus a final exit code:
 *   0 — all green
 *   1 — preflight or offline failed (real regression — must fix)
 *   2 — warmup couldn't run (operator skip, e.g. no backend) — not fatal
 *       but reported.
 *
 * Override switches via env:
 *   AISHA_SMOKE_SKIP_PREFLIGHT=1   skip phase 1
 *   AISHA_SMOKE_SKIP_OFFLINE=1     skip phase 2 entirely
 *   AISHA_SMOKE_SKIP_BUILD=1       skip the slow `npm run build` step in phase 2
 *                                    (CI fast lane: test:stack:ci sets this)
 *   AISHA_SMOKE_SKIP_SERVICES=1    skip `npm run test:services` step in phase 2
 *   AISHA_SMOKE_SKIP_UNIT=1        skip `npm run test:run` (cílený pre-push: unit jen dotčené)
 *   AISHA_SMOKE_SKIP_GATES=1       skip `npm run test:gates` (cílený pre-push: brány jen dotčené)
 *   AISHA_SMOKE_SKIP_WARMUP=1      skip phase 3 (CI default)
 *   AISHA_SMOKE_GATEWAY_URL=...    override gateway URL (default: http://localhost:3001)
 *   AISHA_SMOKE_SERVICE_TOKEN=...  override service-role JWT (default: $POSTGREST_SERVICE_TOKEN)
 *   AISHA_SMOKE_TIMEOUT_MS=...     per-step timeout (default 30 000)
 *
 * Usage:
 *   npm run test:stack
 *   AISHA_SMOKE_SKIP_WARMUP=1 npm run test:stack        # CI mode
 *   AISHA_SMOKE_GATEWAY_URL=https://api.example.com npm run test:stack
 *
 * Designed to be re-runnable as the operator brings backend pieces online.
 *
 * @module scripts/test/stack-smoke
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { insightNeedsValidation } from '../lib/insight-validation.mjs';
import { behNicNezmeril, maDefinitivniVerdikt } from '../lib/beh-nic-nezmeril.mjs';
import { KOD_NEZMERENO, KOD_ZELENA, verdiktFazi } from './verdikt-kody.mjs';
import { cestaArtefaktuBehu } from '../lib/cesta-artefaktu-behu.mjs';
import { ensureNotBare } from '../lib/git-worktree-health.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPORTS_DIR = resolve(ROOT, '.aisha/reports/stack-smoke');
mkdirSync(REPORTS_DIR, { recursive: true });

const TIMEOUT_MS = Number.parseInt(process.env.AISHA_SMOKE_TIMEOUT_MS ?? '30000', 10);

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

const C = {
  ok: '\x1b[32m✓\x1b[0m',
  warn: '\x1b[33m⚠\x1b[0m',
  fail: '\x1b[31m✗\x1b[0m',
  skip: '\x1b[90m∅\x1b[0m',
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
};

function header(title) {
  console.log('\n' + C.bold(`━━ ${title} ${'━'.repeat(Math.max(0, 60 - title.length))}`));
}

function runStep(label, command, args = [], opts = {}) {
  process.stdout.write(`  ${label} … `);
  const t0 = Date.now();
  const res = spawnSync(command, args, {
    cwd: ROOT,
    stdio: opts.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    timeout: opts.timeoutMs ?? TIMEOUT_MS * 4,
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.status === 0) {
    console.log(`${C.ok} ${C.dim(`(${elapsed}s)`)}`);
    return { ok: true, output: opts.quiet ? String(res.stdout) : '' };
  }
  console.log(`${C.fail} ${C.dim(`(${elapsed}s)`)}`);
  if (opts.quiet) {
    // The whole failure, kept on disk. An 8-line tail was the old behaviour and
    // it discarded the only thing worth reading: vitest prints the assertion
    // (test name, expected/received, the offending files) BEFORE the summary,
    // so a tail shows the counts and drops the evidence. Measured 2026-08-09:
    // a one-in-many-runs gate red survived pre-push as "1 failed | 6367 passed"
    // with the remediation footer saying "the assertion message above lists the
    // specific offenders" — while no assertion had been printed at all. A red
    // you cannot read is a red you are trained to re-run.
    const full = `${String(res.stdout ?? '')}\n${String(res.stderr ?? '')}`;
    let savedTo = null;
    try {
      // ⛔ ARTEFAKT PATŘÍ BĚHU, NE KROKU. Jméno odvozené jen z kroku má na
      // stroji s deseti sezeními jednoho vítěze — kdo psal naposled. Obsluha
      // pak otevře vypsanou cestu a čte CIZÍ pád. Naměřeno 2026-09-20; jedna
      // relace tak skutečně přečetla cizí nález jako svůj. Viz cesta-artefaktu-behu.mjs.
      const zaklad = process.env.AISHA_REPORT_DIR
        ? resolve(process.env.AISHA_REPORT_DIR)
        : join(tmpdir(), 'aisha-reports');
      const cesta = cestaArtefaktuBehu(zaklad, label);
      mkdirSync(cesta.adresar, { recursive: true });
      savedTo = cesta.soubor;
      writeFileSync(savedTo, full);
    } catch (err) {
      // Say so. A diagnostics path that fails silently is the very defect this
      // block exists to fix — but it must not mask the step failure either, so
      // it warns and carries on rather than throwing.
      console.warn(`  (could not save full output: ${err?.message ?? err})`);
      savedTo = null;
    }
    const tail = String(res.stdout ?? '').split('\n').slice(-40).join('\n');
    if (tail.trim()) console.log(C.dim(tail));
    const errTail = String(res.stderr ?? '').split('\n').slice(-20).join('\n');
    if (errTail.trim()) console.log(C.dim(errTail));
    if (savedTo) console.log(C.dim(`  full output: ${savedTo}`));
  }
  const vystup = `${String(res.stdout ?? '')}\n${String(res.stderr ?? '')}`;
  // ⛔ NÁVRATOVÝ KÓD JE SILNĚJŠÍ DŮKAZ NEŽ REGEX NAD VÝPISEM. `behNicNezmeril`
  // čte `vystup` — jenže kroky bez `quiet` běží se `stdio: 'inherit'`, takže
  // `res.stdout` je PRÁZDNÝ a detektor je u nich slepý. Přesně tam přitom leží
  // `npm run test:gates`, tedy krok, který zamrzáním trpí nejvíc. Kód
  // KOD_NEZMERENO doručí run-vitest.mjs vždy, i bez jediného zachyceného bajtu.
  let nezmereno = false;
  if (res.status === KOD_NEZMERENO || behNicNezmeril(vystup)) {
    // ⛔ PODPIS PORUCHY VEDLE NÁLEZU NENÍ „NIC SE NENAMĚŘILO". Naměřeno
    // 2026-09-21: lehká dráha vrátila kód 1 a report jmenoval konkrétní padlé
    // tvrzení, ale ve výstupu byl VEDLE TOHO podpis vypršelého RPC — a krok se
    // uzavřel jako NEZMĚŘENO s hláškou „nehledej vadu v kódu". Vada tam byla.
    //
    // Opakovat se má dál (fantomová selhání z vypršelého RPC vypadají stejně a
    // rozhodne až druhý běh), ale MLUVIT se o tom musí jinak — a verdikt po
    // opakování se bere z DŮKAZU, ne z podpisu.
    const maNalez = maDefinitivniVerdikt(vystup);
    if (!opts.jeOpakovani) {
      console.log(
        maNalez
          ? `  ${C.warn} podpis poruchy měřidla (timeout RPC) VEDLE jmenovitého nálezu — ` +
              `opakuji JEDNOU, abych zjistil, jestli je nález STÁLÝ. Stálý nález je nález, ` +
              `ne nezměřeno; fantom z vypršelého RPC se v druhém běhu neopakuje.`
          : `  ${C.warn} NEZMĚŘENO${res.status === KOD_NEZMERENO ? ` (kód ${KOD_NEZMERENO})` : ''}: ` +
              `běh nenechal důkaz o tom, jak testy dopadly ` +
              `(zamrzlý worker, timeout onTaskUpdate, chybějící report). ` +
              `Tenhle běh NIC NEZMĚŘIL — opakuji JEDNOU, verdikt druhého běhu je konečný.`,
      );
      return runStep(label, command, args, { ...opts, jeOpakovani: true });
    }
    if (maNalez && res.status !== KOD_NEZMERENO) {
      console.log(
        `  ${C.fail} nález je STÁLÝ — objevil se v obou bězích, takže je to SELHÁNÍ, ` +
          `ne nefunkční měřidlo. Oprav ho; „zopakuj běh" by tady byl špatný pokyn.`,
      );
      return { ok: false, nezmereno: false, output: opts.quiet ? String(res.stderr ?? res.stdout) : '' };
    }
    // ⛔ TENHLE PŘÍZNAK MUSÍ VYLÉZT AŽ NAHORU. Dosud se poznání „nefunkční
    // měřidlo" vypsalo na obrazovku a TÍM SKONČILO: `{ ok: false }` je od
    // padlé brány k nerozeznání, fáze se uzavřela jako `✗ offline (FAIL)` a
    // pre-push zamítl push s hláškou „oprav před pushem". Nástroj tedy správně
    // poznal, že nic nenaměřil, a pak se zachoval, jako by naměřil vadu.
    // (Naměřeno 2026-09-20 dvakrát na téže větvi.)
    nezmereno = true;
    console.log(
      `  ${C.fail} ani opakovaný běh nic nezměřil. Tohle NENÍ nález, ale nefunkční ` +
        `měřidlo — sniž souběžnost (fileParallelism) nebo strop haldy. ` +
        `Nedělej z toho červenou nad kódem.`,
    );
  }
  return { ok: false, nezmereno, output: opts.quiet ? String(res.stderr ?? res.stdout) : '' };
}

async function tryFetch(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return { ok: true, status: res.status, body: await res.text().catch(() => '') };
  } catch (err) {
    return { ok: false, status: 0, error: (err instanceof Error ? err.message : String(err)) };
  } finally {
    clearTimeout(timer);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// PHASE 1 — Preflight
// ──────────────────────────────────────────────────────────────────────────

function phasePreflight() {
  if (process.env.AISHA_SMOKE_SKIP_PREFLIGHT === '1') {
    console.log(`  ${C.skip} phase skipped via AISHA_SMOKE_SKIP_PREFLIGHT=1`);
    return { ok: true, skipped: true };
  }

  // ⚠️ BEZPODMÍNEČNĚ, JEŠTĚ PŘED submodulovým krokem.
  //
  // MĚŘENO 2026-08-05: tahle kontrola byla schovaná UVNITŘ větve „submoduly
  // chybí, doinicializuj je", takže se pouštěla jen tehdy, když ten krok
  // proběhl. Jenže `core.bare=true` v repu přežije běh: nastaví ho jakýkoli
  // dřívější `git submodule update` (třeba z minulého pushe nebo z jiné
  // session). Pak se šlo `else` větví, kontrola se nespustila, a repozitář
  // zůstal rozbitý — `git grep` končí „must be run in a work tree" a padnou
  // legacy-domains, dockerignore-vs-dockerfile-copy, anthropic-body-builder.
  //
  // Sebeudržující smyčka: jednou rozbité → každý další push padá na bránách,
  // se kterými měřená změna nemá nic společného → a preflight to nikdy
  // neopraví, protože submoduly UŽ inicializované jsou. Změřeno: preflight
  // ohlásil „✓ preflight" nad repozitářem, kde `core.bare` zůstalo `true`.
  //
  // Modul sám to má v hlavičce správně — „neptá se, kdo to rozbil, kontroluje
  // vlastnost". Vadné bylo VOLÁNÍ, ne modul.
  const entryHealth = ensureNotBare(ROOT);
  if (entryHealth.repaired) {
    console.log(
      `  ${C.warn} core.bare bylo TRUE nad pracovním stromem UŽ PŘED během — opraveno na false ` +
        C.dim('(zbytek po dřívějším submodule update; jinak by git grep a s ním několik bran selhalo)'),
    );
  }

  const submoduleDir = resolve(ROOT, 'packages/insight');
  const submoduleInit = existsSync(resolve(submoduleDir, '.git')) || existsSync(resolve(submoduleDir, 'Pipfile'));
  let submoduleStep = { ok: true };
  if (!submoduleInit && existsSync(resolve(ROOT, '.gitmodules'))) {
    submoduleStep = runStep('git submodule update --init', 'git', ['submodule', 'update', '--init', '--recursive'], { quiet: true });
    // ⚠️ Ten krok umí přepsat `.git/config` NADPROJEKTU na `bare = true` (měřeno
    // 2026-08-04 v linked worktree). Pak `git grep` končí „must be run in a work
    // tree" a spadnou VŠECHNY brány, které si univerzum hledají přes git — tedy
    // preflight si sám vyrobí regresi, kterou o dvě fáze níž nahlásí jako vadu
    // kódu. Kontroluje se to hned tady, ne až v bránách, protože tam už by to
    // vypadalo jako jejich problém.
    const health = ensureNotBare(ROOT);
    if (health.repaired) {
      console.log(
        `  ${C.warn} core.bare bylo po submodule update TRUE nad pracovním stromem — opraveno na false ` +
          C.dim('(jinak by git grep a s ním několik bran selhalo)'),
      );
    }
    if (!submoduleStep.ok) {
      // packages/insight is pinned to the aisha fork (repo.id3a.cz/aisha/insight);
      // some environments may still lack submodule access. It is REQUIRED only when THIS change
      // touches insight — i.e. the (pin, patches) differs from the recorded
      // attestation — because then the patch-apply validation must run against real
      // content. When insight is unchanged, the prior attestation holds → advisory.
      if (insightNeedsValidation(ROOT)) {
        console.log(`  ${C.fail} submodule packages/insight REQUIRED — insight pin/patches changed; content needed to validate the patches.`);
        // keep submoduleStep.ok = false → preflight fails (no skipping a changed-insight validation)
      } else {
        console.log(`  ${C.skip} submodule packages/insight unreachable — insight unchanged vs attestation; advisory, continuing.`);
        submoduleStep = { ok: true };
      }
    }
  } else {
    console.log(`  ${submoduleInit ? C.ok : C.skip} submodule packages/insight ${C.dim(submoduleInit ? 'initialized' : 'no .gitmodules')}`);
  }

  const reportPath = resolve(ROOT, 'docs/db-structure/source-truth-report.json');
  let analyzeStep = { ok: true };
  if (!existsSync(reportPath)) {
    analyzeStep = runStep('npm run db-mgr:source', 'npm', ['run', 'db-mgr:source'], { quiet: true });
  } else {
    console.log(`  ${C.ok} source-truth-report.json ${C.dim('exists')}`);
  }

  return { ok: submoduleStep.ok && analyzeStep.ok, skipped: false };
}

// ──────────────────────────────────────────────────────────────────────────
// PHASE 2 — Offline (no keys, no stack)
// ──────────────────────────────────────────────────────────────────────────

function phaseOffline() {
  if (process.env.AISHA_SMOKE_SKIP_OFFLINE === '1') {
    console.log(`  ${C.skip} phase skipped via AISHA_SMOKE_SKIP_OFFLINE=1`);
    return { ok: true, skipped: true };
  }
  // Mirrors what pre-push runs — if this is green, push is green.
  // Per-step opt-outs so CI fast lanes can drop the slow ones (build, services).
  const steps = [
    { label: 'npx tsc --noEmit -p tsconfig.app.json', cmd: 'npx', args: ['tsc', '--noEmit', '-p', 'tsconfig.app.json'] },
    { label: 'npm run lint', cmd: 'npm', args: ['run', 'lint'] },
    // test:gates je DRUHÁ dlouhá sada (obě dráhy, ~7 500 tvrzení nad 700 soubory) a
    //   dosud jela na výchozím 20× (=10 min). ⛔ NAMĚŘENO 2026-09-12: na zatíženém
    //   stroji (load 14–16) trvá sama 9 min, takže strop vypršel UPROSTŘED zeleného
    //   běhu — táž třída, jakou u `test:run` popisuje komentář níž (timeout zabíjí
    //   skutečné běhy a tváří se jako nález). 40× (=20 min) dává tutéž rezervu;
    //   opravdové zatuhnutí dál chytají vlastní timeouty vitestu.
    //   `AISHA_SMOKE_SKIP_GATES=1`: cílený pre-push (rozhodnutí majitele 2026-10-05 „plné sady
    //   jen v CI") pouští místo celé sady jen dotčené brány (scripts/ci/prepush-cilene.mjs);
    //   přeskok se VYPÍŠE jako u unit/services/build. Celou sadu měří CI (Web: Brány).
    { label: 'npm run test:gates', cmd: 'npm', args: ['run', 'test:gates'], env: { AISHA_SKIP_ONLINE: '1' }, optional: true, skipEnv: 'AISHA_SMOKE_SKIP_GATES', timeoutMs: TIMEOUT_MS * 40 },
    { label: 'npm run validate:static', cmd: 'npm', args: ['run', 'validate:static'] },
    { label: 'npm run i18n:check', cmd: 'npm', args: ['run', 'i18n:check'] },
    // test:run is the full ~5400-unit suite — legitimately ~13-20 min (heavy env/collect
    //   setup, not test logic). The old 30x (=15 min) step timeout KILLED real runs
    //   mid-flight (observed 764s/900s/1227s across runs → flaky "timeout" failures that
    //   were NOT real test failures). 60x (=30 min) leaves comfortable margin; genuine
    //   hangs are still caught by vitest's own per-test timeouts.
    // `AISHA_SMOKE_SKIP_UNIT=1`: cílený pre-push ji vynechá a pustí jen testy, které změněné
    // moduly přímo importují (scripts/ci/prepush-cilene.mjs); přeskok se VYPÍŠE jako u services/build.
    { label: 'npm run test:run', cmd: 'npm', args: ['run', 'test:run', '--silent'], optional: true, skipEnv: 'AISHA_SMOKE_SKIP_UNIT', timeoutMs: TIMEOUT_MS * 60 },
    { label: 'npm run test:services', cmd: 'npm', args: ['run', 'test:services'], optional: true, skipEnv: 'AISHA_SMOKE_SKIP_SERVICES', timeoutMs: TIMEOUT_MS * 30 },
    { label: 'npm run build', cmd: 'npm', args: ['run', 'build'], optional: true, skipEnv: 'AISHA_SMOKE_SKIP_BUILD', timeoutMs: TIMEOUT_MS * 20 },
  ];
  let ok = true;
  const nezmerene = [];        // kroky, které ani po opakování nic nenaměřily
  let selhaloZmerene = false;  // aspoň jeden krok poctivě spadl (to je nález)
  for (const s of steps) {
    if (s.skipEnv && process.env[s.skipEnv] === '1') {
      console.log(`  ${C.skip} ${s.label} ${C.dim(`(skipped via ${s.skipEnv}=1)`)}`);
      continue;
    }
    // ⭐ ZDRAVÍ MĚŘIDLA PŘED KAŽDÝM KROKEM, ne jednou na začátku fáze.
    //
    // `core.bare=true` nad pracovním stromem shodí `git grep`, a s ním KAŽDOU
    // bránu, která si univerzum hledá přes git (legacy-domains,
    // anthropic-body-builder, dockerignore-vs-dockerfile-copy, no-legacy-envs).
    // ZMĚŘENO 2026-08-07 přímým pokusem: s `core.bare=true` padá 9 tvrzení
    // v 5 souborech, s `false` prochází 506/507. Táž sada, týž commit.
    //
    // Kontrola stála výš jen jednou před fází — jenže hodnotu překlápí NĚCO
    // BĚHEM běhu (pod pre-push se to stalo opakovaně, po ručním spuštění ne).
    // Kdo přesně, dosud nevím; proto se neptám KDO, ale hlídám VLASTNOST —
    // a to před každým krokem, protože mezi kroky se stav evidentně mění.
    const zdravi = ensureNotBare(ROOT);
    if (zdravi.repaired) {
      console.log(
        `  ${C.warn} core.bare bylo TRUE před „${s.label}" — opraveno ` +
          C.dim('(jinak by git grep a s ním pět bran selhalo)'),
      );
    }
    const result = runStep(s.label, s.cmd, s.args, { quiet: true, env: s.env, timeoutMs: s.timeoutMs ?? TIMEOUT_MS * 20 });
    if (!result.ok) {
      ok = false;
      if (result.nezmereno) nezmerene.push(s.label);
      else selhaloZmerene = true;
    }
  }
  return { ok, skipped: false, nezmerene, selhaloZmerene };
}

// ──────────────────────────────────────────────────────────────────────────
// PHASE 3 — Warmup smoke (detected backend)
// ──────────────────────────────────────────────────────────────────────────

function detectBackend() {
  const detected = [];
  if (process.env.AISHA_LLM_MOCK === '1') detected.push({ kind: 'mock', label: 'AISHA_LLM_MOCK=1 (deterministic fixture)' });
  if (process.env.OLLAMA_URL) detected.push({ kind: 'ollama', label: `Ollama @ ${process.env.OLLAMA_URL}` });
  if (process.env.VLLM_GENERATION_URL) detected.push({ kind: 'vllm', label: `vLLM @ ${process.env.VLLM_GENERATION_URL} (Apple Silicon / GPU)` });
  if (process.env.DOCKER_MODEL_RUNNER_URL) detected.push({ kind: 'docker', label: `Docker Model Runner @ ${process.env.DOCKER_MODEL_RUNNER_URL}` });
  if (process.env.LLM_GATEWAY_URL) detected.push({ kind: 'gateway', label: `AISHA LLM Gateway @ ${process.env.LLM_GATEWAY_URL}` });
  if (process.env.MAESTRO_URL) detected.push({ kind: 'maestro', label: `Maestro @ ${process.env.MAESTRO_URL}` });
  if (process.env.ANTHROPIC_API_KEY) detected.push({ kind: 'anthropic', label: 'Anthropic (cloud, requires key)' });
  if (process.env.OPENAI_API_KEY) detected.push({ kind: 'openai', label: 'OpenAI (cloud, requires key)' });
  if (process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY) detected.push({ kind: 'google', label: 'Google AI (cloud, requires key)' });
  return detected;
}

async function phaseWarmup() {
  if (process.env.AISHA_SMOKE_SKIP_WARMUP === '1') {
    console.log(`  ${C.skip} phase skipped via AISHA_SMOKE_SKIP_WARMUP=1 (CI mode)`);
    return { ok: true, skipped: true };
  }

  const backends = detectBackend();
  if (backends.length === 0) {
    console.log(`  ${C.skip} no LLM backend env detected — set AISHA_LLM_MOCK=1 for mock, or OLLAMA_URL / VLLM_GENERATION_URL / OPENAI_API_KEY / etc.`);
    return { ok: true, skipped: true, reason: 'no_backend_configured' };
  }
  console.log(`  ${C.dim('detected backends:')}`);
  for (const b of backends) console.log(`    · ${b.label}`);

  const gatewayUrl = process.env.AISHA_SMOKE_GATEWAY_URL ?? process.env.AISHA_GATEWAY_URL ?? 'http://localhost:3001';
  const serviceToken = process.env.AISHA_SMOKE_SERVICE_TOKEN ?? process.env.POSTGREST_SERVICE_TOKEN ?? '';

  process.stdout.write(`  gateway @ ${gatewayUrl} reachable … `);
  const health = await tryFetch(`${gatewayUrl}/health`, { timeoutMs: 3000 });
  if (!health.ok || health.status >= 500) {
    console.log(`${C.skip} ${C.dim(`(${health.error ?? health.status})`)}`);
    console.log(`  ${C.skip} stack not running — bring up postgrest + svc-ai-chat + svc-web-artifact then re-run`);
    return { ok: true, skipped: true, reason: 'stack_not_up' };
  }
  console.log(`${C.ok} ${C.dim(`(${health.status})`)}`);

  if (!serviceToken) {
    console.log(`  ${C.warn} POSTGREST_SERVICE_TOKEN not set — cannot exercise service-role endpoints; aborting warmup`);
    return { ok: true, skipped: true, reason: 'no_service_token' };
  }

  // ── 3a: /ai-generate with a tiny prompt — proves router + provider wiring
  process.stdout.write(`  /functions/v1/ai-generate (task_kind=chat) … `);
  const aiRes = await tryFetch(`${gatewayUrl}/functions/v1/ai-generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${serviceToken}` },
    body: JSON.stringify({
      task_kind: 'chat',
      risk_profile: 'low',
      messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
      max_tokens: 32,
    }),
  });
  let aiOk = aiRes.ok && aiRes.status === 200;
  let aiInfo = '';
  if (aiOk) {
    try {
      const body = JSON.parse(aiRes.body);
      aiInfo = `${body.mock ? 'mock' : body.provider}/${body.model}`;
    } catch (parseErr) {
      aiOk = false;
      console.warn(`  ${C.warn} /ai-generate returned non-JSON body: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
    }
  }
  console.log(aiOk ? `${C.ok} ${C.dim(`(${aiInfo})`)}` : `${C.warn} ${C.dim(`(status=${aiRes.status})`)}`);

  // ── 3b: /web-artifact-seed-default — idempotent, proves whole pipeline
  process.stdout.write(`  /functions/v1/web-artifact-seed-default … `);
  const seedRes = await tryFetch(`${gatewayUrl}/functions/v1/web-artifact-seed-default`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${serviceToken}` },
    body: '{}',
  });
  const seedOk = seedRes.ok && (seedRes.status === 200 || seedRes.status === 304);
  console.log(seedOk ? `${C.ok} ${C.dim(`(${seedRes.status === 304 ? 'idempotent no-op' : 'seeded'})`)}` : `${C.warn} ${C.dim(`(status=${seedRes.status})`)}`);

  return { ok: true, skipped: false, ai: { ok: aiOk, info: aiInfo }, seed: { ok: seedOk, status: seedRes.status } };
}

// ──────────────────────────────────────────────────────────────────────────
// orchestrator
// ──────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(C.bold('AISHA stack smoke runner'));
  console.log(C.dim(`  root: ${ROOT}`));
  console.log(C.dim(`  timeout: ${TIMEOUT_MS} ms`));

  header('PHASE 1 — preflight');
  const p1 = phasePreflight();

  header('PHASE 2 — offline (no keys)');
  // ⭐ ZDRAVÍ MĚŘIDLA SE OVĚŘUJE PŘED MĚŘENÍM, NE UVNITŘ JEDNÉ VĚTVE.
  //
  // `ensureNotBare` se dosud volalo JEN uvnitř `if (!submoduleInit && …)`, tedy
  // v téže větvi, která mutaci působí. Na stroji, kde je submodul dávno
  // inicializovaný, se ten blok přeskočí — a když `core.bare` překlopí cokoli
  // JINÉHO (jiný krok, jiný nástroj, předchozí běh), oprava neproběhne vůbec.
  //
  // Následek je nejhorší možný tvar vady v měřidle: `git grep` skončí na
  // „must be run in a work tree", spadnou VŠECHNY brány sahající na git, a
  // hlášení zní jako regrese kódu. Naměřeno 2026-08-07 třikrát po sobě —
  // ručně 506/506 zelených, pod pre-push červená, týž commit i stroj.
  //
  // Kontrola tedy patří sem, bezpodmínečně a bez ohledu na to, KDO stav rozbil:
  // fáze, která měří, si napřed ověří, že měřit vůbec může.
  const preOffline = ensureNotBare(ROOT);
  if (preOffline.repaired) {
    console.log(
      `  ${C.warn} core.bare bylo TRUE nad pracovním stromem — opraveno na false ` +
        C.dim('(jinak by git grep a s ním několik bran selhalo)'),
    );
  }
  const p2 = phaseOffline();

  header('PHASE 3 — warmup smoke');
  const p3 = await phaseWarmup();

  header('summary');
  const symbol = (r) => (r.skipped ? C.skip : r.ok ? C.ok : C.fail);
  console.log(`  ${symbol(p1)} preflight   ${C.dim(p1.skipped ? '(skipped)' : p1.ok ? '' : '(FAIL)')}`);
  const nezmereneKroky = p2.nezmerene ?? [];
  // Pravidla sčítání fází bydlí ve verdikt-kody.mjs, aby se dala OVĚŘIT sondou
  // (tenhle skript se pro test spustit nedá — trvá půl hodiny a sahá na repo).
  const verdikt = verdiktFazi({
    preflightOk: p1.ok,
    offlineOk: p2.ok,
    offlineNezmerene: nezmereneKroky,
    offlineSelhaloZmerene: p2.selhaloZmerene,
  });
  const jenNezmereno = verdikt.jenNezmereno;
  console.log(
    `  ${jenNezmereno ? C.warn : symbol(p2)} offline     ` +
      C.dim(
        p2.skipped
          ? '(skipped)'
          : p2.ok
            ? ''
            : jenNezmereno
              ? `(NEZMĚŘENO: ${nezmereneKroky.join(', ')})`
              : '(FAIL — fix regressions before warmup)',
      ),
  );
  console.log(`  ${symbol(p3)} warmup      ${C.dim(p3.skipped ? `(skipped: ${p3.reason ?? 'opt-out'})` : p3.ok ? '' : '(FAIL)')}`);

  if (verdikt.kod !== KOD_ZELENA) {
    // ⛔ NEOVĚŘENO NENÍ OVĚŘENO — ALE TAKY NENÍ NÁLEZ. Když offline fáze selhala
    // JEN nezměřenými kroky (a preflight prošel), push se pořád nepouští: nikdo
    // nic neověřil. Mění se ale DIAGNÓZA a návratový kód, protože „oprav před
    // pushem" posílá člověka hledat vadu, která možná vůbec neexistuje.
    if (verdikt.kod === KOD_NEZMERENO) {
      console.log(
        `\n${C.warn} ${C.bold(`exit ${KOD_NEZMERENO}`)} — NEZMĚŘENO: ` +
          `${nezmereneKroky.join(', ')} nic nenaměřily ani při opakování.\n` +
          `  Tohle NENÍ nález: žádná brána nespadla — jen se nikdo nedozvěděl, jak dopadly.\n` +
          `  Nehledej vadu v kódu, zopakuj běh. Na zatíženém stroji se stejnou\n` +
          `  souběžností, jakou jede CI (naměřeno, že to stačí):\n` +
          `      VITEST_MAX_WORKERS=2 npm run test:stack:ci\n`,
      );
      process.exit(KOD_NEZMERENO);
    }
    console.log(`\n${C.fail} ${C.bold('exit 1')} — preflight or offline regression must be fixed`);
    process.exit(1);
  }
  if (p3.skipped && p3.reason && p3.reason !== 'opt-out') {
    console.log(`\n${C.warn} ${C.bold('exit 2')} — warmup couldn't run (${p3.reason}); rerun once the stack is up`);
    process.exit(2);
  }
  console.log(`\n${C.ok} ${C.bold('exit 0')} — all green`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n${C.fail} stack-smoke crashed: ${err?.message ?? err}`);
  process.exit(1);
});
