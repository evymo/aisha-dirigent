/**
 * Local Warmup Idempotence Gate
 *
 * Ověří, že `scripts/local-compose-gen.mjs` je idempotent — opakované volání
 * se stejným presetem vyplivne **byte-identický** výstup. To chrání před:
 *   - Non-deterministic output (timestamp, random IDs, hash-based naming)
 *   - Side effects, které se přidávají s každým runem
 *   - Drift mezi `.env.local.dev` a generated compose
 *
 * Co testujeme:
 *   1. Generator vyvolán 2× s `--preset minimum` → stejný JSON
 *   2. Stejné pro `optimum` a `full-light`
 *   3. `.env.local.dev` (auto-generated) je taky byte-identický
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
// ⛔ MIMO REPO, NE `.tmp/` UVNITŘ NĚJ. Úklid v `afterAll` nestačí: soubory
// existují po celou dobu běhu téhle brány (~7 s) a sada běží PARALELNĚ, takže
// je jiná brána vidí. Naměřeno 2026-08-31: `instance-identity-natvrdo`
// nahlásila 16 nálezů „realm 'aisha' vepsaný natvrdo" v
// `.tmp/idempotence-test/minimum-run1.json` — v souboru, který sem právě
// generoval tenhle test. Selhávalo to jen V SADĚ; obě brány samostatně
// procházely, takže to vypadalo jako náhoda.
//
// Audit identity `.gitignore` schválně NECTÍ (a má to zdůvodněné: `.env.coolify`
// je ignorovaný a právě tam by natvrdo zapsaná identita škodila). Vyjmout
// `.tmp/` z auditu by tedy vyrobilo slepou skvrnu v měřidle. Správná strana
// opravy je tahle: pracovní soubory nepatří do stromu, který někdo měří.
const TMPDIR = mkdtempSync(join(tmpdir(), "aisha-idempotence-"));
const GENERATOR = join(ROOT, "scripts/local-compose-gen.mjs");

/**
 * The generator pipes through `docker compose config --format json` to
 * canonicalize YAML + resolve env interpolation. CI sandboxes without
 * Docker (e.g. self-hosted runners not configured with Docker-in-Docker)
 * fail every test in this gate with "docker: command not found". Skip
 * cleanly when docker isn't available — the gate is only meaningful in
 * an environment with the generator's full dependency chain. Production
 * pre-push (developer workstations + CI runners with Docker) keeps full
 * coverage.
 */
const HAS_DOCKER = spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status === 0;

function runGen(preset: string, outFile: string): string {
  // Run generator with explicit --out so we don't clobber the canonical compose.
  // Redirect the generator's .env side-effect to a per-invocation temp (AISHA_DEV_ENV_FILE)
  // instead of the shared repo .env.local.dev — otherwise a PARALLEL gate file running this
  // same generator with a DIFFERENT preset clobbers the shared file mid-test (the side-effect
  // is preset-dependent: `# AISHA_LOCAL_PRESET=<preset>`), making the read-back flaky. Each
  // run gets its own `<outFile>.env`; the compose render uses that same env-file too.
  execFileSync("node", [GENERATOR, "--preset", preset, "--out", outFile], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
    env: { ...process.env, AISHA_DEV_ENV_FILE: `${outFile}.env` },
  });
  return readFileSync(outFile, "utf-8");
}

describe.skipIf(!HAS_DOCKER)("local-compose-gen idempotence", () => {
  beforeAll(() => {
    if (!existsSync(TMPDIR)) {
      mkdirSync(TMPDIR, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up tmpdir so we don't leak generated files into the repo
    try { rmSync(TMPDIR, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
  });

  test.each(["minimum", "optimum", "full-light"])(
    "preset=%s — two consecutive generator runs produce byte-identical output",
    (preset) => {
      const out1 = join(TMPDIR, `${preset}-run1.json`);
      const out2 = join(TMPDIR, `${preset}-run2.json`);

      const json1 = runGen(preset, out1);
      const json2 = runGen(preset, out2);

      expect(json1.length).toBeGreaterThan(100);
      expect(json2.length).toBe(json1.length);
      expect(json2).toBe(json1);
    },
    // 90s timeout per preset: solo runs are ~2s but under parallel gate-suite
    // load the generator's `node` startup + module resolution gets contention.
    // Proper fix would be to optimize the generator (or pre-warm via vitest
    // setupFiles), but for a stable pre-push gate this timeout is enough.
    90_000
  );

  test("generated dev env is byte-identical between runs", () => {
    // Each run writes its OWN <outFile>.env (runGen sets AISHA_DEV_ENV_FILE), so this
    // asserts the generation is deterministic WITHOUT racing the shared repo
    // .env.local.dev against parallel gate files (the flake this gate used to hit).
    const out1 = join(TMPDIR, "minimum-env-1.json");
    const out2 = join(TMPDIR, "minimum-env-2.json");
    runGen("minimum", out1);
    const env1 = readFileSync(`${out1}.env`, "utf-8");
    runGen("minimum", out2);
    const env2 = readFileSync(`${out2}.env`, "utf-8");
    expect(env1.length).toBeGreaterThan(100);
    expect(env2).toBe(env1);
  }, 60_000);
});
