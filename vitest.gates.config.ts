/**
 * Vitest configuration for Gate tests.
 *
 * Gate tests are static-analysis / architecture / hygiene checks
 * that run in Node environment (not jsdom) and may need longer timeouts.
 *
 * Usage:
 *   npm run test:gates
 *   npx vitest run --config vitest.gates.config.ts src/tests/gates/
 *
 * @module
 */
import { defineConfig } from "vitest/config";
import path from "path";
import { readFileSync } from "fs";

// ─── Dráhy bran ──────────────────────────────────────────────────────────────
// ⛔ NAMĚŘENO 2026-08-31 per-soubor (poprvé; dosud jen agregát): 630 souborů,
// 227 s CPU, MEDIÁN souboru 20 ms — a devět souborů spolkne 114 s = 50 %.
// Sada tedy není „pomalá"; je nerovnoměrná. Rozdělení na dráhy dovolí lehké
// dráze POCTIVÝ timeout: dnešních 300 s je kalibrovaných na nejhorší případ
// pod kontencí, takže vyprchání hlásí PRÁZDNÝ nález a vypadá jako rozbitý
// detektor. Bez těžkých bran stačí 30 s a vyprchání zase znamená vadu.
//
// Seznam žije v `src/tests/gates/lanes.json` s naměřenými časy, ne tady —
// aby ho uměly číst i skripty a hooky (a aby čísla šla ověřit).
const LANES = JSON.parse(
  readFileSync(path.resolve(__dirname, "src/tests/gates/lanes.json"), "utf-8"),
) as { heavy: { soubor: string }[] };
const HEAVY = LANES.heavy.map((h) => `src/tests/gates/**/${h.soubor}`);
// ⛔ UZAVŘENÝ VÝČET, NE FALLBACK. První verze měla `?? "all"` a brána
// `zadny-fallback-nad-identitou` ji správně odmítla (naměřeno 2026-08-31:
// „vitest.gates.config.ts: 0 → 1"). Rozdíl je v tom, ČÍM ta hodnota je:
// adresa serveru nebo jméno instance jsou fakty o světě a dosadit je znamená
// hádat; dráha je naopak volba ze tří pojmenovaných režimů, kterou vyslovuje
// volající. Vyjmenovat je tedy poctivé — a navíc to odmítne překlep
// (`AISHA_GATES_LANE=ligth` spadne na „all", ne na tichou polovinu sady).
const LANE_ZADANA = process.env.AISHA_GATES_LANE;
const LANE: "light" | "heavy" | "all" =
  LANE_ZADANA === "light" ? "light" : LANE_ZADANA === "heavy" ? "heavy" : "all";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // ⛔ NAMĚŘENO 2026-08-22: brány dosud běžely na TVARU NASAZENÍ, který si
    // resolver sám dosadil (`?? "cloud-single"`), zatímco cold-start si na touž
    // otázku dosazoval `cloud-multi`. CI tedy měřila jiný tvar, než jaký se
    // nasazuje, a nikdo to nemohl poznat — obojí bylo zelené.
    //
    // Brána musí DEKLAROVAT, co měří. Mlčení tady neznamená „výchozí tvar",
    // znamená „měříme něco, co nikdo nezvolil". Změna tvaru je proto viditelná
    // změna TOHOTO řádku, ne tichý posun uvnitř knihovny.
    // Deklarace, ne dosazení: `?? "cloud-multi"` by byl fallback nad prostředím
    // (a račna `zadny-fallback-nad-identitou` ho hned chytila — správně).
    // Sada bran měří JEDEN zvolený tvar; kdo chce jiný, změní tenhle řádek.
    env: { AISHA_PROFILE: "cloud-multi" },
    include:
      LANE === "heavy" ? HEAVY : ["src/tests/gates/**/*.gate.test.ts"],
    // Lehká dráha vylučuje naměřené žrouty; ostatní dráhy nevylučují nic.
    exclude: LANE === "light" ? HEAVY : [],
    // Parallelization across gate files. Gates are stateless static analysis
    // (file reads, AST scans, regex matches) so parallelism is safe.
    // Empirical timing on 10-core machine:
    //   maxWorkers: 1 → 77s (was the original, sequential)
    //   maxWorkers: 4 → 36s (53% speedup)
    //   maxWorkers: 8 → 28s (64% speedup, near-saturation)
    // We default to 8 — still leaves 2 cores for OS / IDE on dev machines,
    // CI typically has ≥8 cores too. minWorkers: 2 prevents single-worker
    // fallback when initial parallel startup is slow.
    fileParallelism: true,
    // CI on the memory-limited self-hosted runner sets VITEST_MAX_WORKERS=2:
    // 8 node workers across 239 gate files (each spawning git/db subprocesses)
    // OOM the runner (#279). Local/CI-with-RAM keeps 8 (fast).
    // ⛔ TĚŽKÁ DRÁHA NENÍ SÉRIOVÁ. Naměřeno: 114 s CPU; plně sériově by to byly
    // skoro 2 minuty. Tři workeři to srazí na ~38 s a kontenci drží nízko —
    // právě ta z 1,1s brány dělá 131s (zdokumentováno u sousedů v tomhle
    // souboru). Sériovost by byla přesnější měření za cenu, kterou nikdo
    // nechce platit při každém pushi.
    maxWorkers: process.env.VITEST_MAX_WORKERS
      ? Number(process.env.VITEST_MAX_WORKERS)
      : LANE === "heavy"
        ? 3
        : 8,
    // clamp <= maxWorkers: with VITEST_MAX_WORKERS=1 (CI) a hardcoded minWorkers:2
    // makes Tinypool throw "minThreads and maxThreads must not conflict" (#279).
    minWorkers: process.env.VITEST_MAX_WORKERS ? Math.min(2, Number(process.env.VITEST_MAX_WORKERS)) : 2,
    // ⏱ NAMĚŘENO 2026-08-19. Brány, které si spouštějí PODPROCESY (git commit
    // v dočasném repu, `sh -n` na každý příkaz z compose, celý Node proces
    // detektoru), se pod 8 workery perou o 10 jader — a zpomalení není o desítky
    // procent, ale řádové:
    //     prikaz-v-compose-se-da-rozparsovat   izolace 1,1 s → pod sadou 131 s
    //     zmena-sluzby-dosahne-na-svuj-stack   izolace 7,6 s → pod sadou >120 s
    // Obě padaly na `Test timed out`, tedy s PRÁZDNÝM nálezem — a v předpushové
    // bariéře to vypadalo jako vada compose, resp. jako rozbitý detektor
    // vlastnictví. Strop se proto řídí nejhorším během POD ZÁTĚŽÍ, ne v izolaci.
    // 5 min je pořád bounded: skutečné zamrznutí (∞) spadne dál.
    // 300 s je kalibrovaných na nejhorší případ POD KONTENCÍ, ne na práci —
    // vyprchání pak hlásí PRÁZDNÝ nález a vypadá jako rozbitý detektor.
    // V lehké dráze smí být limit řádově nižší, ale NE 30 s:
    //
    // ⛔ NAMĚŘENO 2026-09-01. Prvních 30 s pod pre-push zátěží shodilo dvě
    // brány, které na nezatíženém stroji trvaly 14 s a 11 s — pod zátěží
    // 42,6 s a >30 s. TROJNÁSOBEK. Čas z klidného běhu je DOLNÍ odhad, ne
    // hodnota; brány s podprocesem rostou pod kontencí nejvíc.
    // 60 s (shodně s hookTimeout) tenhle trojnásobek pokrývá a pořád je 5×
    // přísnější než 300 s, takže vyprchání zase něco znamená.
    testTimeout: LANE === "light" ? 60_000 : 300_000,
    teardownTimeout: 30_000, // worker IPC cleanup; default 10s timeoutoval
    hookTimeout: 60_000,    // 1 min — vitest defaults beforeAll/afterAll to 10s,
                            // too tight for SQL/SoT analyzer gates that walk the full
                            // aisha/db tree on first hook. source-of-truth-analyzer.gate
                            // + sql-type-consistency.gate hit Hook-timed-out flakes in
                            // pre-push runs under load. 60s matches the testTimeout
                            // pattern (generous but bounded).
    reporters: [
      "default",
      "./src/tests/gates/gates-json-reporter.ts",
      // actionable remediation footer on every gate failure (file + re-run + fix)
      "./src/tests/gates/gates-remediation-reporter.ts",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@aisha/api-core": path.resolve(__dirname, "./packages/api-core/src/index.ts"),
      "@aisha/capture-ui": path.resolve(__dirname, "./packages/capture-ui/src/index.ts"),
    },
  },
});
