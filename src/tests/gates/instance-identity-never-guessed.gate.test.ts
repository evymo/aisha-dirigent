/**
 * Gate: the instance a run acts on is declared, never guessed and never literal.
 *
 * WHY THIS EXISTS (2026-07-21)
 * ---------------------------
 * One Coolify hosts several instances side by side (aisha-*, <fork>-*,
 * <other-fork>-*). Two shapes let a run act on the wrong one:
 *
 *   GUESSED  — a `|| "aisha"` at the end of a resolution chain. The incident:
 *              a caller exported AISHA_PROFILE (a topology selector, not an
 *              instance identity), APP_NAME_PREFIX was unset, the chain fell
 *              through, and RIQ's env was written into 8 production aisha-* apps
 *              (64 of 168 variables in aisha-core, including COLUMN_ENCRYPTION_KEY).
 *
 *   LITERAL  — a target hardcoded in source. pki-bridge-deploy.mjs matched
 *              `a.name === "aisha-pki"`, so running it from the RIQ worktree wrote
 *              RIQ's PKI credentials into AISHA's PKI app. Strictly worse than the
 *              guess: no configuration could make it correct.
 *
 * generate-secrets.mjs is where this matters most, because it PRODUCES the
 * declaration every later consumer trusts. A guess there is not a default, it is
 * a forged identity that nothing downstream can detect.
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = process.cwd();
const GENERATE = join(ROOT, "scripts/generate-secrets.mjs");
const PKI_DEPLOY = join(ROOT, "scripts/pki-bridge-deploy.mjs");
const INSTANCE_SCOPE = join(ROOT, "scripts/lib/coolify-instance-scope.mjs");

/**
 * The invariant is that SOMETHING in the derivation chain fails closed — not that
 * a particular file spells it. A caller may derive the prefix inline or delegate
 * to the shared resolver; both satisfy the contract, and an assertion pinned to
 * the caller alone would fail the moment the logic is deduplicated (measured
 * 2026-08-11: it did).
 *
 * Following the import keeps the gate honest in the direction that matters — a
 * caller that delegates to nothing, or to a resolver that does not refuse, still
 * fails. `--print-keys` above covers the behaviour; this covers the shape.
 */
function derivationSource(callerPath: string): string {
  const caller = readFileSync(callerPath, "utf-8");
  const delegates = /from\s+["']\.\/lib\/coolify-instance-scope\.mjs["']/.test(caller);
  return delegates ? `${caller}\n${readFileSync(INSTANCE_SCOPE, "utf-8")}` : caller;
}

let workdir: string;

function runGenerate(opts: { declare?: string; args?: string[] }): {
  code: number | null;
  out: string;
  stdout: string;
  wroteEnvFile: boolean;
} {
  const cwd = mkdtempSync(join(workdir, "gen-"));
  const env: Record<string, string | undefined> = { ...process.env };
  // Every channel generate-secrets consults must be silent unless the test arms one.
  delete env.APP_NAME_PREFIX;
  delete env.AISHA_STORY;
  if (opts.declare) env.APP_NAME_PREFIX = opts.declare;

  const r = spawnSync("node", [GENERATE, ...(opts.args ?? [])], {
    cwd,
    env: env as NodeJS.ProcessEnv,
    encoding: "utf-8",
    timeout: 60_000,
  });
  return {
    code: r.status,
    out: (r.stdout ?? "") + (r.stderr ?? ""),
    stdout: r.stdout ?? "",
    // generate-secrets only writes a file when handed --env-coolify; by default it
    // emits to stdout. Either way the DECLARATION is what matters, so that is what
    // these tests assert on.
    wroteEnvFile: existsSync(join(cwd, ".env.coolify")),
  };
}

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), "instance-identity-gate-"));
});
afterAll(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

describe("instance identity: declared, never guessed", () => {
  /**
   * THE REGRESSION TEST. Nothing declares the instance, so there is no honest
   * answer — and writing a guessed one poisons every consumer downstream.
   */
  test("nothing declares the instance → generate-secrets refuses and writes nothing", () => {
    const r = runGenerate({});
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/cannot determine APP_NAME_PREFIX/i);
    expect(r.out, "must say why guessing is not an option").toMatch(/another instance|Refusing to invent/i);
    expect(r.stdout, "a refused run must emit no declaration at all").not.toMatch(/^APP_NAME_PREFIX=/m);
    expect(r.wroteEnvFile).toBe(false);
  });

  /**
   * Negative control: the normal path must still work, or the test above would
   * pass for a script that simply always fails.
   */
  test("instance declared → generates, and emits exactly what was declared", () => {
    // A fictional instance on purpose: asserting on a real deployment's slug
    // would make the generic test suite depend on which fork it runs in.
    const r = runGenerate({ declare: "acme" });
    expect(r.code).toBe(0);
    expect(r.stdout, "the declaration must be the operator's value, verbatim").toMatch(
      /^APP_NAME_PREFIX=['"]?acme['"]?$/m,
    );
    expect(r.stdout, "and must never be silently rewritten to the upstream default").not.toMatch(
      /^APP_NAME_PREFIX=['"]?aisha['"]?$/m,
    );
  });

  /**
   * --print-keys lists managed key NAMES and writes no env file, so there is no
   * declaration to forge. Requiring an identity there would be guard theatre.
   */
  test("--print-keys needs no instance: it emits no declaration", () => {
    const r = runGenerate({ args: ["--print-keys"] });
    expect(r.code).toBe(0);
    expect(r.wroteEnvFile).toBe(false);
  });
});

describe("instance identity: never a literal in source", () => {
  /**
   * A target compared against a literal instance name cannot be redirected by any
   * configuration — it is a permanent cross-tenant write. Behavioural coverage is
   * impossible without a live Coolify, so this pins the shape at the source, which
   * is legitimate here: the literal IS the defect, not a spelling of it.
   */
  test("pki-bridge-deploy resolves its target by prefix, not by a hardcoded name", () => {
    const src = readFileSync(PKI_DEPLOY, "utf-8");
    const code = src
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"));

    expect(
      code.filter((l) => /"aisha-[a-z-]+"/.test(l)),
      "no literal instance-qualified app name may appear in targeting code",
    ).toEqual([]);
    expect(src, "the prefix must be derived").toMatch(/instancePrefix\(/);
    expect(
      derivationSource(PKI_DEPLOY),
      "and the derivation must fail closed — in the script or in the resolver it delegates to",
    ).toMatch(/cannot determine APP_NAME_PREFIX/);
  });

  /**
   * The derivation must refuse a contradiction rather than pick a side — the same
   * contract coolify-sync-envs.sh got in b492f506.
   */
  test("ambient prefix contradicting the env file is fatal, not resolved by precedence", () => {
    const src = derivationSource(PKI_DEPLOY);
    expect(src).toMatch(/refusing to act/i);
    expect(src).toMatch(/declares/);
  });
});
