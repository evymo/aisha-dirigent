/**
 * Gate: an env sync must know WHICH INSTANCE it writes to, or refuse to run.
 *
 * WHY THIS EXISTS (2026-07-21, cross-instance write on a shared Coolify)
 * ---------------------------------------------------------------------
 * One Coolify hosts several instances side by side — aisha-*, tenant-*,
 * another-tenant-* … The target is chosen by APP_NAME_PREFIX, and the resolution
 * used to end in `${APP_NAME_PREFIX:-${AISHA_STORY:-aisha}}`.
 *
 * That default is not a harmless convenience. A caller that exported
 * AISHA_PROFILE (a DIFFERENT variable) left APP_NAME_PREFIX unset, the chain
 * fell through to "aisha", and the run pushed TENANT's .env.coolify into eight
 * aisha-* production apps — 103 variables into aisha-core alone — then queued
 * their redeploys. The source of truth was sitting in the file being synced the
 * whole time: .env.coolify itself declares APP_NAME_PREFIX=tenant.
 *
 * The script's own comment had already described this failure once, for the
 * hardcoded-"aisha-" variant. The fix at the time kept the fallback, so the hole
 * stayed open for the case where the variable is merely absent. Hence a gate
 * rather than a third comment.
 *
 * The invariant: the instance is DERIVED from the env file being synced, a
 * disagreement between file and environment is fatal, and an undeterminable
 * instance is fatal. Never guessed.
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = process.cwd();
const SYNC = join(ROOT, "scripts/coolify-sync-envs.sh");

// The positive path runs the whole sync script, which requires jq (as it does at
// runtime). The refusal tests exit before the jq check, and the source-level
// tests do not spawn it, so only this one needs jq — skip it where jq is absent
// rather than fail on the environment.
const HAS_JQ = spawnSync("jq", ["--version"]).status === 0;

let workdir: string;

/** Runs the sync in DRY_RUN with a synthetic env file; returns output + exit code. */
function run(opts: {
  fileDeclares?: string;
  ambient?: string;
  withManifest?: boolean;
  /** Poziční argumenty skriptu (jména aplikací — nebo omylem přepínač). */
  args?: string[];
  /** DRY_RUN=1 v prostředí; výchozí ano. `false` = obsluha spoléhá jen na argumenty. */
  dryRunEnv?: boolean;
}): { out: string; code: number | null } {
  const scen = mkdtempSync(join(workdir, "scen-"));
  const envFile = join(scen, ".env.coolify");
  const lines = [
    "COOLIFY_API_TOKEN=stub",
    "COOLIFY_URL=http://coolify.invalid",
    "PUBLIC_TLD=example.test",
  ];
  if (opts.fileDeclares) lines.push(`APP_NAME_PREFIX=${opts.fileDeclares}`);
  writeFileSync(envFile, lines.join("\n") + "\n");

  const env: Record<string, string> = {
    ...process.env,
    ENV_FILE: envFile,
    DRY_RUN: "1",
    COOLIFY_API: "http://coolify.invalid/api/v1",
    // Supplied on BOTH channels on purpose. Which one the script reads its
    // credentials from is not what this gate is about, and pinning that made the
    // positive-path test fail against a revision that resolves the token
    // differently — a fixture that is accidentally coupled to an unrelated
    // implementation detail tests that detail, not the property.
    COOLIFY_API_TOKEN: "stub",
    COOLIFY_BASE_URL: "http://coolify.invalid",
    COOLIFY_URL: "http://coolify.invalid",
    // Likewise: this gate is about WHICH INSTANCE the run resolves, not about the
    // env-contract preflight. Leaving the preflight on made the outcome depend on
    // whether a synthetic fixture happens to satisfy an unrelated contract.
    SKIP_ENV_PREFLIGHT: "1",
  };
  delete env.APP_NAME_PREFIX;
  delete env.AISHA_STORY;
  if (opts.dryRunEnv === false) delete env.DRY_RUN;
  if (opts.ambient) env.APP_NAME_PREFIX = opts.ambient;

  // A positive run needs a manifest for the declared instance to exist. The
  // platform intentionally ships NO per-instance manifests, so the test creates
  // its own throwaway one and points the script at it via MANIFEST_FILE (the
  // documented override at scripts/coolify-sync-envs.sh) — never a committed
  // instance manifest.
  if (opts.withManifest && opts.fileDeclares) {
    const manifestFile = join(scen, `${opts.fileDeclares}.manifest`);
    writeFileSync(manifestFile, `app: ${opts.fileDeclares}-core:backend:docker-compose.coolify.yml\n`);
    env.MANIFEST_FILE = manifestFile;
  }

  // ⛔ 8 s, ne 60 s. Tahle brána měří, KTEROU INSTANCI běh zvolí — a to je
  // rozhodnuto dřív, než padne první síťový dotaz: řádek „Discover <instance>
  // apps" je na stdout v 0,52 s (naměřeno 2026-08-31). Zbytek času je dojíždění
  // produkční retry politiky `coolify-sync-envs.sh` (`--retry 6 --retry-delay 10`
  // = přesně 60 s), protože fixtura míří na nepřeložitelný host. Ta politika je
  // pro ostrý provoz správná a tahle brána o ní NENÍ.
  //
  // Cena toho čekání byla měřitelná: 60,0 s v jediném testu = 15 % času CELÉ
  // sady bran (389 s CPU / 630 souborů) a zároveň nejdelší soubor v běhu, tedy
  // spodní hranice wall-clocku při paralelním běhu.
  //
  // Sémantika se NEMĚNÍ: spawnSync i dosud končil timeoutem a test tvrdil nad
  // částečným výstupem — jen o 52 s později. 8 s je ~15× rezerva nad naměřenou
  // hodnotou pro zatížený stroj.
  const r = spawnSync("bash", [SYNC, ...(opts.args ?? [])], { encoding: "utf-8", env, timeout: 8_000 });
  return { out: (r.stdout ?? "") + (r.stderr ?? ""), code: r.status };
}

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), "sync-scope-gate-"));
});
afterAll(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

describe("coolify env sync: the instance is derived, never guessed", () => {
  /**
   * THE REGRESSION TEST. This is the exact shape of the incident: the caller did
   * not export APP_NAME_PREFIX, and the file says "tenant". It must target tenant —
   * and above all must NOT reach for aisha.
   */
  test.skipIf(!HAS_JQ)("no ambient prefix → takes the instance from the env file, not a default", () => {
    const r = run({ fileDeclares: "tenant", withManifest: true });
    expect(r.out).toMatch(/Discover tenant apps/i);
    expect(r.out, "must never silently retarget at the upstream instance").not.toMatch(/Discover aisha apps/i);
  });

  /** Nothing declares the instance: writing anywhere would be a guess. */
  test("instance undeterminable → refuses to run", () => {
    const r = run({});
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/cannot determine APP_NAME_PREFIX/i);
    expect(r.out).toMatch(/Refusing to sync/i);
  });

  /**
   * Two sources disagreeing means one of them points at the wrong production.
   * Guessing which is exactly the mistake being prevented.
   */
  test("ambient prefix contradicts the env file → refuses to run", () => {
    const r = run({ fileDeclares: "tenant", ambient: "aisha" });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/but .*declares 'tenant'/i);
    expect(r.out).toMatch(/Refusing to sync/i);
  });

  /** A missing manifest must stop the run, not borrow another instance's. */
  test("no manifest for the instance → refuses, does not borrow one", () => {
    const r = run({ fileDeclares: "nosuchinstance" });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/manifest for instance 'nosuchinstance' not found/i);
    expect(r.out).toMatch(/Refusing to fall back/i);
  });

  /**
   * Source-level backstop: the specific expression that caused the incident must
   * not come back. Behavioural coverage is above; this catches a reintroduction
   * that happens to be unreachable in the scenarios tested.
   */
  test("no aisha-defaulting expression survives in the targeting chain", () => {
    const src = readFileSync(SYNC, "utf-8");
    const offenders = src
      .split("\n")
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => !l.trimStart().startsWith("#"))
      .filter(([, l]) => /\$\{(APP_NAME_PREFIX|AISHA_STORY)[^}]*:-[^}]*aisha/.test(l));
    expect(offenders.map(([n, l]) => `${n}: ${l.trim()}`)).toEqual([]);
  });
});

/**
 * Přepínač NENÍ jméno aplikace.
 *
 * NÁLEZ 2026-09-23 (obhlídka forku): `coolify-sync-envs.sh --dry-run core` zapisoval
 * naostro. Skript přepínače nečte (volby jdou prostředím), takže `--dry-run` spadl
 * do filtru jmen aplikací, na nic nesedl a filtr ho mlčky vynechal — `core` sedl
 * a dostal zápis. Otázka „smím zapisovat?" tak dostala odpověď „ano".
 *
 * Měří se na scénáři, který by jinak PROŠEL (instance deklarovaná, manifest je),
 * a bez DRY_RUN v prostředí — přesně v situaci obsluhy, která spoléhala na přepínač.
 * Na scénáři, který padá z jiného důvodu, by se odmítnutí přepínače nedalo odlišit.
 */
describe("coolify env sync: přepínač se neinterpretuje jako jméno aplikace", () => {
  test("`--dry-run core` bez DRY_RUN → odmítne DŘÍV, než cokoli přečte", () => {
    const r = run({ fileDeclares: "tenant", withManifest: true, args: ["--dry-run", "core"], dryRunEnv: false });
    expect(r.code, r.out.slice(-600)).toBe(2);
    expect(r.out).toMatch(/neznámý přepínač '--dry-run'/);
    expect(r.out, "hláška musí říct, jak volbu zadat správně").toMatch(/DRY_RUN=1/);
    // Odmítnutí musí předejít výběru aplikací — jinak by „zkouška" už sahala do API.
    expect(r.out, "po odmítnutí nesmí dojít k výběru aplikací").not.toMatch(/Discover tenant apps/i);
  });

  test("přepínač kdekoli mezi jmény → odmítne (nejen na prvním místě)", () => {
    const r = run({ fileDeclares: "tenant", withManifest: true, args: ["core", "--redeploy"], dryRunEnv: false });
    expect(r.code, r.out.slice(-600)).toBe(2);
    expect(r.out).toMatch(/neznámý přepínač '--redeploy'/);
  });

  /** Kontrolní vzorek: jméno aplikace samo odmítnutí nespustí — jinak by šlo „splnit" odmítáním všeho. */
  test.skipIf(!HAS_JQ)("samotné jméno aplikace → projde k výběru aplikací", () => {
    const r = run({ fileDeclares: "tenant", withManifest: true, args: ["core"] });
    expect(r.out).not.toMatch(/neznámý přepínač/);
    expect(r.out).toMatch(/Discover tenant apps/i);
  });
});
