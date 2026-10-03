/**
 * Gate: the committed compiled seed must stay in sync with its source layers.
 *
 * `aisha/db/seed.compiled.sql` (and its byte-identical mirror `aisha/db/seed.sql`)
 * are GENERATED artifacts — committed to git for the DEMO profile and produced by
 * `scripts/db/compile-seed.mjs` from the source files under `aisha/db/seed/`.
 *
 * They drift silently: a new source file (e.g. core/36_discussion_entry_types.sql,
 * PR #516) gets added but the committed artifact is never regenerated. Production
 * self-heals — the docker entrypoint recompiles at deploy
 * (scripts/docker-migrate-entrypoint.sh) — but CI/local paths that consume the
 * committed file directly (scripts/db/with-throwaway-db.mjs,
 * scripts/db/verify-upgrade-apply.sh step 6/6) then run a STALE seed silently.
 *
 * The sibling gate seed-layer-profiles.gate.test.ts checks compiler BEHAVIOR only
 * (which sections a profile selects); it never compares the committed bytes. This
 * gate closes that gap: it recompiles the demo profile in memory (--stdout, writes
 * nothing) and asserts byte-equality with both committed mirrors.
 *
 * HOW TO FIX a failure — regenerate the committed artifact for the DEMO profile:
 *     AISHA_SEED_PROFILE=demo npm run db:seed:compile
 *   then commit aisha/db/seed.compiled.sql and aisha/db/seed.sql.
 *
 * NOTE: the committed file is the DEMO profile, so this gate forces
 * AISHA_SEED_PROFILE=demo. The compiler default is `platform` — a bare
 * `npm run db:seed:compile` emits a different file and is NOT the fix.
 *
 * @module
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const COMPILED = join(ROOT, "aisha/db/seed.compiled.sql");
const MIRROR = join(ROOT, "aisha/db/seed.sql");

const REMEDIATION =
  "regenerate the committed demo seed:\n" +
  "      AISHA_SEED_PROFILE=demo npm run db:seed:compile\n" +
  "    then commit aisha/db/seed.compiled.sql and aisha/db/seed.sql.";

/**
 * Recompile the DEMO profile and return its SQL. `--stdout` makes the compiler
 * print the compiled SQL and write NO files (progress goes to stderr), so the
 * gate stays read-only — it never mutates the working tree the way `--output`
 * would (compile-seed.mjs also rewrites seed.sql in place on a normal compile).
 */
function compileDemoSeed(): string {
  return execFileSync("node", ["scripts/db/compile-seed.mjs", "--stdout"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, AISHA_SEED_PROFILE: "demo" },
    // Compiled seed is ~1.4 MB — well over execFileSync's 1 MB default maxBuffer.
    maxBuffer: 64 * 1024 * 1024,
    // Capture stdout; swallow the human progress the compiler writes to stderr.
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Pinpoint the first differing line so a failure says WHERE, not just THAT. */
function firstDivergence(generated: string, committed: string): string {
  const g = generated.split("\n");
  const c = committed.split("\n");
  const n = Math.max(g.length, c.length);
  for (let i = 0; i < n; i++) {
    if (g[i] !== c[i]) {
      return (
        `first divergence at line ${i + 1}:\n` +
        `      generated: ${JSON.stringify(g[i] ?? "<missing>")}\n` +
        `      committed: ${JSON.stringify(c[i] ?? "<missing>")}`
      );
    }
  }
  return `line-by-line identical but byte length differs (generated ${generated.length} vs committed ${committed.length})`;
}

function failureMessage(label: string, generated: string, committed: string): string {
  return (
    `${label} is OUT OF SYNC with its source files under aisha/db/seed/.\n` +
    `    ${firstDivergence(generated, committed)}\n` +
    `  → ${REMEDIATION}`
  );
}

describe("compiled seed stays in sync with source layers", () => {
  let generated: string;

  beforeAll(() => {
    generated = compileDemoSeed();
  });

  it("aisha/db/seed.compiled.sql matches the demo compiler output", () => {
    const committed = readFileSync(COMPILED, "utf8");
    // Compare booleans (not the 1.4 MB strings) so a failure prints our targeted
    // message instead of Vitest dumping a giant diff.
    expect(generated === committed, failureMessage("aisha/db/seed.compiled.sql", generated, committed)).toBe(true);
  });

  it("aisha/db/seed.sql mirror matches the demo compiler output", () => {
    const committed = readFileSync(MIRROR, "utf8");
    expect(generated === committed, failureMessage("aisha/db/seed.sql", generated, committed)).toBe(true);
  });

  it("aisha/db/seed.sql is a byte-identical mirror of aisha/db/seed.compiled.sql", () => {
    const a = readFileSync(COMPILED, "utf8");
    const b = readFileSync(MIRROR, "utf8");
    expect(
      a === b,
      "aisha/db/seed.sql must be a byte-identical mirror of aisha/db/seed.compiled.sql;\n" +
        `  → ${REMEDIATION}`,
    ).toBe(true);
  });
});
