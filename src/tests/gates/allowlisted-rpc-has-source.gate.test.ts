/**
 * Gate: every RPC a surface block dispatches to exists in the SQL source of truth.
 *
 * WHY THIS EXISTS (2026-07-28)
 * ---------------------------
 * `get_answer_block` and `get_answer_coverage_block` are ACTIVE in the live
 * instance's RPC allowlist, back two blocks of the `ask` section, and answer
 * HTTP 200 in production. Their definition exists in no repository — not this
 * one, not the instance-data overlay, not the dissolved surfaces repo, not the
 * generated baseline. They live only inside the running database.
 *
 * A cold start therefore reproduces the block, the allowlist row and the layout
 * placement — and then `get_block_data` calls a function that was never created.
 * The section comes up broken on a fresh deploy, and every check that reads the
 * LIVE database says everything is fine, because there it exists.
 *
 * This is the mirror of the check that already runs: "no active allowlist row
 * without a live function" looks from the database at the schema. This one looks
 * from the declaration at the SOURCE, which is the direction a cold start cares
 * about — a function nobody can recreate is a function the next deploy loses.
 *
 * COVERAGE IS PRINTED, NOT ASSUMED
 * The allowlist and the block declarations live in the instance-data repo, so
 * this can only read them when AISHA_INSTANCE_CONFIG_DIR points at that
 * checkout. Absent, the test says out loud that it checked nothing rather than
 * passing quietly — a green here with no declarations read would be the same
 * empty reassurance that let the two orphans survive this long.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { overlayDirOrRequired } from "../../../scripts/lib/instance-overlay.mjs";

const ROOT = process.cwd();
const FUNCTIONS_DIR = join(ROOT, "aisha/db/sql/functions");
// Jedny dveře k overlayi (scripts/lib/instance-overlay.mjs). Tahle brána bez
// něj MĚŘÍ NULU, takže volí volitelný režim s hlasitým přiznáním — a v CI, kde
// overlay k dispozici JE, ho AISHA_OVERLAY_REQUIRED=1 povýší na povinný.
const INSTANCE_DIR = overlayDirOrRequired("allowlisted-rpc-has-source");

/**
 * RPC names the instance declares as reachable: rows of `surface_data_rpcs`
 * inserted with is_active true, plus whatever `surface_blocks.source_rpc`
 * points at. Both are read from the overlay's SQL — the same files the deploy
 * applies — so the gate cannot disagree with what actually gets installed.
 */
function declaredRpcs(dir: string): Set<string> {
  const names = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, f), "utf8");

    // insert into surface_data_rpcs (...) values ('get_x', '…', true)
    for (const ins of sql.matchAll(
      /insert\s+into\s+(?:public\.)?surface_data_rpcs\s*\(([^)]*)\)\s*values\s*([\s\S]*?);/gi,
    )) {
      const cols = ins[1].split(",").map((c) => c.trim().toLowerCase());
      const at = cols.indexOf("rpc_name");
      if (at < 0) continue;
      for (const tuple of ins[2].matchAll(/\(([\s\S]*?)\)\s*(?=,\s*\(|$|\s*on\s+conflict)/gi)) {
        const parts = tuple[1].split(",").map((p) => p.trim());
        const m = (parts[at] ?? "").match(/^'([a-z][a-z0-9_]*)'$/);
        if (m) names.add(m[1]);
      }
    }

    // `set source_rpc = 'x'` — an ASSIGNMENT. Deliberately not
    // `where source_rpc = 'x'`: a rename writes
    //   update … set source_rpc='new' where source_rpc='old'
    // and the WHERE side names a function that is being REMOVED. Matching it
    // made a first version of this gate demand source files for the four
    // get_riq_* names that had just been renamed away — a gate that fails
    // because the cleanup worked.
    for (const m of sql.matchAll(/\bset\s+source_rpc\s*=\s*'([a-z][a-z0-9_]*)'/gi)) names.add(m[1]);

    // insert into surface_blocks (…, source_rpc, …) values (…) — the POSITIONAL
    // form, which is how most blocks declare their RPC. Missing it is why the
    // first version overlooked get_answer_coverage_block, one of the two live
    // orphans this gate exists to catch.
    for (const ins of sql.matchAll(
      /insert\s+into\s+(?:public\.)?surface_blocks\s*\(([^)]*)\)\s*values\s*([\s\S]*?);/gi,
    )) {
      const cols = ins[1].split(",").map((c) => c.trim().toLowerCase());
      const at = cols.indexOf("source_rpc");
      if (at < 0) continue;
      for (const tuple of ins[2].matchAll(/\(([\s\S]*?)\)\s*(?=,\s*\(|$|\s*on\s+conflict)/gi)) {
        // Top-level commas only — source_params is jsonb and contains its own.
        const parts: string[] = [];
        let depth = 0;
        let cur = "";
        let inStr = false;
        for (let i = 0; i < tuple[1].length; i++) {
          const ch = tuple[1][i];
          if (ch === "'" && tuple[1][i - 1] !== "\\") inStr = !inStr;
          if (!inStr && (ch === "(" || ch === "[")) depth++;
          if (!inStr && (ch === ")" || ch === "]")) depth--;
          if (!inStr && depth === 0 && ch === ",") { parts.push(cur); cur = ""; continue; }
          cur += ch;
        }
        parts.push(cur);
        const m = (parts[at] ?? "").trim().match(/^'([a-z][a-z0-9_]*)'$/);
        if (m) names.add(m[1]);
      }
    }
  }
  return names;
}

describe("every RPC a block dispatches to exists in the SQL source of truth", () => {
  test("no declared RPC is missing its aisha/db/sql/functions file", () => {
    if (!INSTANCE_DIR || !existsSync(INSTANCE_DIR)) {
      // Not a silent skip: state what was NOT checked, then let the run pass.
      // The instance overlay is a separate private repo and is legitimately
      // absent in a public checkout.
      console.warn(
        "allowlisted-rpc-has-source: AISHA_INSTANCE_CONFIG_DIR unset — " +
          "instance RPC declarations NOT checked (0 declarations read).",
      );
      expect(true).toBe(true);
      return;
    }

    const declared = [...declaredRpcs(INSTANCE_DIR)].sort();
    // An empty read is a broken gauge, not a clean tree: the overlay always
    // declares RPCs, so zero means the parser stopped matching the SQL shape.
    expect(
      declared.length,
      `read 0 RPC declarations from ${INSTANCE_DIR} — the parser no longer matches the overlay's SQL`,
    ).toBeGreaterThan(0);

    const orphans = declared.filter((n) => !existsSync(join(FUNCTIONS_DIR, `${n}.sql`)));

    /**
     * Zero, and it stays zero.
     *
     * This gate was written with a debt of 2: `get_answer_block` and
     * `get_answer_coverage_block` were ACTIVE in the live allowlist, answered
     * HTTP 200 in production, and had a definition in no repository. Both were
     * recovered the same day with pg_get_functiondef against the running
     * database and committed as source — so there is nothing left to tolerate.
     *
     * A count rather than a name list on purpose: the number is the whole
     * statement. If it is ever raised again, that is a decision someone has to
     * write down, not a name quietly appended to a list.
     */
    const KNOWN_LIVE_ONLY = 0;

    expect(
      orphans.length,
      orphans.length > KNOWN_LIVE_ONLY
        ? `RPCs declared by the instance overlay with NO definition in aisha/db/sql/functions:\n` +
          orphans.map((n) => `  ${n}`).join("\n") +
          `\n\nThese would exist only in a running database. A cold start recreates the\n` +
          `block, the allowlist row and the layout placement — and then dispatches to a\n` +
          `function that was never created. Recover it with pg_get_functiondef and commit\n` +
          `it as aisha/db/sql/functions/<name>.sql.`
        : "",
    ).toBeLessThanOrEqual(KNOWN_LIVE_ONLY);
  });
});
