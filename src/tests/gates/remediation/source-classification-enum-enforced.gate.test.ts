/**
 * Gate (remediation D2-source-enum-enforced): every source-onboarding ACTIVATION
 * gate in aisha/db/sql/functions/ must enforce the 4-dimension classification by
 * VALUE (set-membership over the allowed enum values), not merely assert the keys
 * are non-null.
 *
 * Contract (SOURCE_ONBOARDING_CONTRACT §1): before a federated source is
 * activated, its classification MUST be valid — source_type, data_sensitivity,
 * retention_class and legal_basis each have a fixed, closed set of legal values.
 * Approving a source whose metadata carries `data_sensitivity: "banana"` is NOT
 * a classified source; it is an unclassified source with a typo. A presence-only
 * (`IS NULL`) gate lets an operator (or a compromised metadata write) activate a
 * source with garbage classification, which then flows straight into
 * audience_resolve_source_binding as if it were governed. The onboarding gate is
 * the ONE place this is checked, so the check must validate the VALUE.
 *
 * The invariant this gate enforces: an activation-gate function (one that flips
 * `source_approved` true / activates the story instance while guarding the 4
 * classification dimensions) must, for EACH of those four dimensions, carry a
 * set-membership enforcement — `... IN (...)`, `= ANY (...)`, `ANY(ARRAY[...])`,
 * a `CHECK (...)`, or an enum/domain cast (`::*_enum`) — co-located with that
 * dimension's metadata key. Bare `IS NULL` does NOT satisfy the contract.
 *
 * KNOWN-RED at authoring time (branch feat/remediation, HEAD 569c5ffd):
 * audience_admin_approve_source.sql guards all four dimensions with `IS NULL`
 * ONLY — zero value-enforcement. It is the single instance this pattern flags
 * today. After the fix (each dimension validated against its allowed value set)
 * this gate goes green.
 *
 * This is a PATTERN gate: it walks every *.sql in the functions dir and applies
 * the invariant to each function that looks like an activation gate, so an
 * overlooked or future sibling (another approve/activate path that guards the
 * same dimensions) is caught automatically. Do NOT allowlist an offender — add
 * the value enforcement. The allowlist below is reserved ONLY for a function
 * proven not to be an activation gate; it is empty today.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FN_DIR = "aisha/db/sql/functions";

/** The four closed-set classification dimensions the contract governs. */
const DIMENSIONS = [
  "source_type",
  "data_sensitivity",
  "retention_class",
  "legal_basis",
] as const;

/**
 * Reserved ONLY for a function file proven NOT to be a source-activation gate.
 * Empty today — every match is a real activation gate that must enforce values.
 */
const ALLOWLIST = new Set<string>([]);

/**
 * A file is a source-activation gate iff it (a) guards ALL four classification
 * dimensions (reads each dimension key out of metadata) and (b) WRITES the
 * source into an approved state — an actual mutation (`UPDATE`) that sets
 * `source_approved`. A read-only materialization (e.g. the onboarding
 * RETURNS TABLE view) references `source_approved` but never UPDATEs it, so it
 * is correctly excluded — it is a reader, not the gate.
 */
function isActivationGate(sql: string): boolean {
  const guardsAll = DIMENSIONS.every((d) => sql.includes(`'${d}'`));
  const activates = /\bUPDATE\b/i.test(sql) && /source_approved/.test(sql);
  return guardsAll && activates;
}

/**
 * True iff `sql` carries a set-membership / value-enforcement construct
 * co-located (within a 260-char window, either direction) with the dimension's
 * metadata key `'<dim>'`. Bare `IS NULL` presence checks do NOT match.
 */
const MEMBERSHIP =
  /(\bIN\s*\(|!?=\s*ANY\s*\(|<>\s*ALL\s*\(|ANY\s*\(\s*ARRAY|\bCHECK\s*\(|::[a-z0-9_]*_enum|\bNOT\s+IN\s*\()/i;

function enforcesValue(sql: string, dim: string): boolean {
  const key = `'${dim}'`;
  let from = 0;
  for (;;) {
    const at = sql.indexOf(key, from);
    if (at === -1) return false;
    const start = Math.max(0, at - 260);
    const window = sql.slice(start, at + key.length + 260);
    if (MEMBERSHIP.test(window)) return true;
    from = at + key.length;
  }
}

const files = readdirSync(join(ROOT, FN_DIR))
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => !ALLOWLIST.has(f));

const gates = files.filter((f) =>
  isActivationGate(readFileSync(join(ROOT, FN_DIR, f), "utf8")),
);

describe("D2 — source classification enforced by value, not just presence", () => {
  test("at least one activation gate exists to check (pattern is live)", () => {
    // Sanity: if this ever hits 0 the detector drifted and the gate is inert.
    expect(gates.length).toBeGreaterThan(0);
  });

  for (const file of gates) {
    const sql = readFileSync(join(ROOT, FN_DIR, file), "utf8");
    for (const dim of DIMENSIONS) {
      test(`${file} enforces allowed values for '${dim}' (set-membership, not IS NULL)`, () => {
        expect(enforcesValue(sql, dim)).toBe(true);
      });
    }
  }
});
