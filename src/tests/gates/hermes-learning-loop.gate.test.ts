/**
 * I4 — Hermes is ADVISORY-ONLY (reflexive-learning rail, human-gated mutations).
 *
 * THE GATE IS THE SPEC. Hermes is the reflexive/expert runtime: closed-story
 * learning and skill creation. The locked invariant is that this rail LEARNS but
 * never PUBLISHES — every mutating step (publishing an agent to the marketplace,
 * installing a learned agent as a runnable story) is HUMAN-GATED, not something
 * the autonomous learning loop performs on its own. Hermes' only execution side
 * is the advisory `evaluate_story_self` RPC; the mutating publish/install RPCs
 * are reached through human approval surfaces, never from the adapter.
 *
 * Two halves, both file-only (no DB / network — safe for pre-push):
 *
 *   (a) SEED — the hermes row in 18_ai_runtime_catalog.sql declares
 *       `read_only` reversibility. A read-only runtime cannot self-effect
 *       mutations; the registry self-description is what fn_runtime_available /
 *       fn_admit_clow match a clow's declared needs against. If hermes ever
 *       declared `reversible` / `irreversible`, the catalog would be advertising
 *       a side-effecting learning loop — exactly the autonomy the owner forbade.
 *
 *   (b) ADAPTER — `hermesAdapter.execute` in adapters.ts invokes ONLY the
 *       advisory `evaluate_story_self` RPC. It must NOT reference the mutating
 *       publish path directly (publish_agent / install_agent_as_story / any
 *       `publish`-shaped RPC). Those are human-gated; reaching them from the
 *       learning rail would close the loop into autonomous self-publishing.
 *
 * Pairs with `runtime-adapter-registry-drift.gate.test.ts` (code↔seed slug
 * drift) and `runtime-availability-no-allowlist.gate.test.ts` (capability-
 * availability derivation).
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const RUNTIME_SEED = "aisha/db/seed/core/18_ai_runtime_catalog.sql";
const ADAPTERS_TS =
  "services/svc-ai-chat/src/reflection/runtime/adapters.ts";

/**
 * Extract the parenthesised VALUES tuple for a given seed slug from the
 * ai_runtime_registry INSERT. The seed lays each runtime out as
 *   ('<slug>', '<display>', '<kind>', <is_enabled>, '<health>', <caps...>, '<notes>')
 * so the tuple opens at `('<slug>'` and closes at the matching `)`. We balance
 * parens while skipping single-quoted SQL string literals (which legitimately
 * contain `(`/`)` inside notes), so the slice is the runtime's own row, not a
 * neighbour's.
 */
function extractSeedTuple(sql: string, slug: string): string {
  const open = sql.indexOf(`('${slug}'`);
  expect(
    open,
    `hermes seed row must exist: '('${slug}'' not found in ${RUNTIME_SEED}`,
  ).toBeGreaterThanOrEqual(0);

  let depth = 0;
  let inString = false;
  for (let i = open; i < sql.length; i++) {
    const ch = sql[i];
    if (inString) {
      // SQL escapes a quote by doubling it ('') — stay in-string across it.
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          i++;
          continue;
        }
        inString = false;
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return sql.slice(open, i + 1);
      }
    }
  }
  throw new Error(
    `unbalanced VALUES tuple for slug '${slug}' in ${RUNTIME_SEED}`,
  );
}

/**
 * Isolate the body of `hermesAdapter.execute(...)` from adapters.ts so the
 * mutation-reference checks apply to the hermes rail SPECIFICALLY — not to a
 * sibling adapter or to a comment elsewhere in the file. Strip block + line
 * comments first so prose that NAMES a forbidden RPC (documenting its absence)
 * can never trip the check.
 */
function hermesExecuteBody(): string {
  const src = read(ADAPTERS_TS);
  const declStart = src.indexOf("export const hermesAdapter");
  expect(
    declStart,
    `hermesAdapter declaration must exist in ${ADAPTERS_TS}`,
  ).toBeGreaterThanOrEqual(0);

  // The adapter object ends at the next top-level `};` after its declaration.
  const declEnd = src.indexOf("\n};", declStart);
  expect(
    declEnd,
    "could not find the end of the hermesAdapter object literal",
  ).toBeGreaterThan(declStart);

  const adapter = src.slice(declStart, declEnd + 3);
  // Strip /* */ block comments and // line comments — assert on CODE only.
  return adapter
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

describe("I4 — hermes is advisory-only (human-gated mutations)", () => {
  // ───────────────────────────────────────────────────────────────────────
  // (a) Seed: hermes declares read_only reversibility (cannot self-effect).
  // ───────────────────────────────────────────────────────────────────────
  describe("seed: the hermes runtime row declares read_only reversibility", () => {
    it("hermes' VALUES tuple carries 'read_only', never a side-effecting class", () => {
      const sql = read(RUNTIME_SEED);
      const tuple = extractSeedTuple(sql, "hermes");

      expect(
        tuple,
        "hermes is the reflexive-learning rail — its registry self-description must " +
          "be read_only so fn_admit_clow can never match a write-needing clow to it",
      ).toContain("read_only");

      // A read_only runtime must NOT also advertise the side-effecting classes.
      // (side_effect_class is a single scalar per row; presence of these in the
      // hermes tuple would mean the learning loop is declared as mutating.)
      expect(
        tuple,
        "hermes must not declare 'reversible' — that is a side-effecting learning loop",
      ).not.toContain("'reversible'");
      expect(
        tuple,
        "hermes must not declare 'irreversible' — that is a side-effecting learning loop",
      ).not.toContain("'irreversible'");

      // can_write is the FIRST capability scalar after the health string; a
      // read_only learning rail ships can_write=false. Guard against it being
      // flipped to true while side_effect_class stays read_only.
      expect(
        tuple,
        "hermes (read_only) must declare can_write=false — it learns, it does not write",
      ).toMatch(/'unknown'\s*,\s*\n?\s*false\b/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // (b) Adapter: hermesAdapter.execute calls ONLY the advisory RPC.
  // ───────────────────────────────────────────────────────────────────────
  describe("adapter: hermesAdapter.execute invokes only the advisory rail", () => {
    it("invokes evaluate_story_self (the advisory learning RPC)", () => {
      const body = hermesExecuteBody();
      expect(
        body,
        "the hermes rail's only execution side is the advisory evaluate_story_self RPC",
      ).toContain("evaluate_story_self");
    });

    // Each forbidden token is a MUTATING marketplace step that must stay
    // human-gated. The learning rail may surface a recommendation, but it must
    // not invoke the publish/install RPCs directly — that would close the loop
    // into autonomous self-publishing.
    const FORBIDDEN_MUTATIONS: ReadonlyArray<readonly [string, string]> = [
      [
        "publish_agent",
        "publishing a learned agent to the marketplace is human-gated, not an autonomous learning step",
      ],
      [
        "install_agent_as_story",
        "installing a learned agent as a runnable story is human-gated, not an autonomous learning step",
      ],
    ];

    for (const [token, why] of FORBIDDEN_MUTATIONS) {
      it(`does NOT reference ${token}`, () => {
        const body = hermesExecuteBody();
        expect(body, why).not.toContain(token);
      });
    }

    it("does NOT invoke any 'publish'-shaped mutation RPC", () => {
      // Catch the whole class: rpc(...'publish_*'...) reached from the learning
      // rail. The advisory evaluate_story_self contains no 'publish' substring,
      // so any 'publish' inside execute() is a mutating call sneaking in.
      const body = hermesExecuteBody();
      const offenders = [...body.matchAll(/\bpublish\w*/g)].map((m) => m[0]);
      expect(
        offenders,
        "hermesAdapter.execute must not reach any publish-shaped mutation — " +
          "publishing is human-gated. Offending tokens: " +
          offenders.join(", "),
      ).toEqual([]);
    });
  });
});
