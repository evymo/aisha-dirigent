/**
 * REMEDIATION GATE — LEDGER OPT-OUT PRESERVATION (D2)
 *
 * CONTRACT (post-fix — assert the CORRECT state, not today's bug)
 * ---------------------------------------------------------------
 * Per LOCKED DECISION D2, the in-DB hash chain is ALWAYS ON, but *new*
 * on-chain / personal anchoring is gated by an opt-out choice stored in TWO
 * places:
 *
 *   (A) PER-MEMBER  — a `ledger_participation` surface (self-RLS row per
 *       member, modelled on story_sync_policies.sql / update_my_cosmos_address.sql)
 *       that records whether a member participates in personal on-chain
 *       anchoring.
 *   (B) PER-INSTANCE — a `LEDGER_ENABLED`-style feature flag.
 *
 * The critical invariant this gate locks: a migration or heal (re-)applied
 * against an EXISTING database MUST NEVER overwrite an operator/member opt-out
 * choice. The opt-out value must be treated EXACTLY like the provider-catalog
 * `is_enabled` column: its seed/heal INSERT uses a preserve-on-conflict
 * pattern (ON CONFLICT DO NOTHING, or ON CONFLICT DO UPDATE whose SET clause
 * does NOT touch the participation/enabled column, or a COALESCE-existing
 * write) — NEVER a blind overwrite of the participation value.
 *
 * This mirrors src/tests/gates/provider-catalog-completeness.gate.test.ts:124
 * ("ON CONFLICT SET clause must NOT include is_enabled — otherwise re-running
 * the migration overrides operator's opt-in/opt-out choice").
 *
 * KNOWN-RED (why this gate exists — verified against feat/service-build-fixes HEAD)
 *   • No `ledger_participation` table (or equivalent per-member opt-out column)
 *     exists anywhere under aisha/db/sql/**.
 *   • No `LEDGER_ENABLED` per-instance flag exists (config/services.json,
 *     compose, config/*.env).
 *   • Because no opt-out storage exists, there is NO preservation guarantee at
 *     all — a re-applied migration/heal has nothing to preserve. The gate is
 *     RED for that reason.
 *
 * Applying the D2 fix (add the `ledger_participation` self-RLS table + the
 * LEDGER_ENABLED flag, and seed/heal the participation value with a
 * preserve-on-conflict pattern) turns each sub-contract GREEN.
 *
 * Run (offline, deterministic, no new deps):
 *   AISHA_SKIP_ONLINE=1 npx vitest run --config vitest.gates.config.ts \
 *     src/tests/gates/remediation/ledger-optout-preservation.gate.test.ts
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const SQL_ROOT = path.resolve(ROOT, "aisha/db/sql");
const HEALS = path.resolve(ROOT, "aisha/db/heals.sql");
const SERVICES_JSON = path.resolve(ROOT, "config/services.json");

function read(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

/** Recursively collect every *.sql file under a directory. */
function walkSql(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSql(abs));
    else if (entry.name.endsWith(".sql")) out.push(abs);
  }
  return out;
}

/** Root-level docker-compose*.y{a,}ml files (per-instance flag surface). */
function composeFiles(): string[] {
  if (!fs.existsSync(ROOT)) return [];
  return fs
    .readdirSync(ROOT)
    .filter((n) => /^docker-compose.*\.ya?ml$/.test(n))
    .map((n) => path.join(ROOT, n));
}

/** *.env under config/ (per-instance flag surface). */
function configEnvFiles(): string[] {
  const dir = path.resolve(ROOT, "config");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".env") || n.endsWith(".env.example"))
    .map((n) => path.join(dir, n));
}

/** Strip `-- ...` SQL line comments so comment prose never triggers a match. */
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

// The per-member opt-out storage surface. D2 names the table
// `ledger_participation`; we also accept an opt-out column on an existing
// per-member table (memberships/profiles) so the gate greenlights either
// faithful implementation of the contract.
const PARTICIPATION_TABLE_RE = /ledger_participation/i;
const PARTICIPATION_COLUMN_RE =
  /\b(ledger_participation|participates_in_ledger|ledger_opt(?:ed)?_out|ledger_opt_in|ledger_enrolled|ledger_participate[sd]?)\b/i;

// The opt-out VALUE column whose prior state must be preserved on re-apply.
const OPTOUT_VALUE_COL_RE =
  /\b(participates?(?:_in_ledger)?|opted?_(?:in|out)|opt_(?:in|out)|ledger_opt(?:ed)?_out|ledger_enabled|is_enrolled|enrolled|is_participating|participating)\b/i;

describe("LEDGER OPT-OUT PRESERVATION (D2) — opt-out choice survives migration/heal re-apply", () => {
  it("(A) a per-member ledger opt-out storage surface exists in aisha/db/sql SoT", () => {
    const sqlFiles = walkSql(SQL_ROOT);
    const hits: string[] = [];

    for (const f of sqlFiles) {
      const body = stripSqlComments(read(f));
      if (PARTICIPATION_TABLE_RE.test(body) || PARTICIPATION_COLUMN_RE.test(body)) {
        hits.push(path.relative(ROOT, f));
      }
    }

    expect(
      hits,
      "No per-member ledger opt-out storage found under aisha/db/sql/**. " +
        "Per D2 add a `ledger_participation` self-RLS table (modelled on " +
        "story_sync_policies.sql + update_my_cosmos_address.sql) or an opt-out " +
        "column on a per-member table so a member's on-chain-anchoring choice " +
        "can be recorded and preserved.",
    ).not.toHaveLength(0);
  });

  it("(B) a LEDGER_ENABLED-style per-instance flag exists (services.json / compose / config env)", () => {
    const blob = [
      read(SERVICES_JSON),
      ...composeFiles().map(read),
      ...configEnvFiles().map(read),
    ].join("\n");

    const flags = new Set<string>();
    for (const t of blob.match(/\b[A-Z][A-Z0-9_]{3,}\b/g) || []) {
      if (/LEDGER/.test(t) && /(ENABLE|ENABLED|FEATURE|FLAG)/.test(t)) flags.add(t);
    }

    expect(
      [...flags],
      "No LEDGER_ENABLED-style per-instance flag found in config/services.json, " +
        "root docker-compose*.yml, or config/*.env. Per D2 the per-instance flag " +
        "gates NEW on-chain/personal anchoring (the in-DB hash chain stays " +
        "unconditionally ON).",
    ).not.toHaveLength(0);
  });

  it("(C) every INSERT/heal that seeds the ledger opt-out value PRESERVES an existing choice (no blind overwrite)", () => {
    // Scan every SoT writer surface: aisha/db/sql/** + heals.sql.
    const writerFiles = [...walkSql(SQL_ROOT), HEALS];

    // Collect INSERT statements that target the ledger opt-out storage.
    // A statement runs from `INSERT INTO` up to the terminating `;`.
    const offenders: string[] = [];
    let sawParticipationWriter = false;

    for (const f of writerFiles) {
      const body = stripSqlComments(read(f));
      const insertRe = /INSERT\s+INTO\s+[^;]*?;/gis;
      const matches = body.match(insertRe) || [];

      for (const stmt of matches) {
        const targetsParticipation =
          PARTICIPATION_TABLE_RE.test(stmt) || PARTICIPATION_COLUMN_RE.test(stmt);
        if (!targetsParticipation) continue;
        sawParticipationWriter = true;

        // Preserve-on-conflict is satisfied by ANY of:
        //   1. ON CONFLICT ... DO NOTHING
        //   2. ON CONFLICT ... DO UPDATE whose SET clause does NOT assign the
        //      opt-out value column (mirrors provider-catalog is_enabled rule).
        //   3. A COALESCE(...) that keeps the existing value.
        const doNothing = /ON\s+CONFLICT[\s\S]*?DO\s+NOTHING/i.test(stmt);
        const coalescePreserve = /COALESCE\s*\(/i.test(stmt);

        let doUpdatePreserves = false;
        const doUpdateMatch = stmt.match(
          /ON\s+CONFLICT[\s\S]*?DO\s+UPDATE\s+SET([\s\S]*?)(?:WHERE|RETURNING|;|$)/i,
        );
        if (doUpdateMatch) {
          const setClause = doUpdateMatch[1];
          // Preserves the choice iff the SET clause never assigns the opt-out
          // value column (`<col> =`).
          const assignsOptoutValue = new RegExp(
            OPTOUT_VALUE_COL_RE.source + "\\s*=",
            "i",
          ).test(setClause);
          doUpdatePreserves = !assignsOptoutValue;
        }

        const preserves = doNothing || coalescePreserve || doUpdatePreserves;
        if (!preserves) {
          offenders.push(
            `${path.relative(ROOT, f)}: INSERT into ledger opt-out storage blindly ` +
              `overwrites the participation/enabled value on re-apply ` +
              `(no ON CONFLICT DO NOTHING, no COALESCE-existing, and its ` +
              `ON CONFLICT DO UPDATE SET assigns the opt-out value column).`,
          );
        }
      }
    }

    // Two ways this is RED, both correct:
    //   • No participation writer exists yet → no preservation guarantee.
    //   • A writer exists but blindly overwrites the choice.
    expect(
      sawParticipationWriter,
      "No seed/heal writer targets a ledger opt-out storage surface, so there " +
        "is NO guarantee an operator/member opt-out choice survives a " +
        "migration/heal re-apply. Add the D2 opt-out storage and seed/heal it " +
        "with a preserve-on-conflict pattern (mirror provider-catalog is_enabled).",
    ).toBe(true);

    expect(
      offenders,
      `Ledger opt-out value is blindly overwritten on re-apply (D2 violation — ` +
        `mirror provider-catalog is_enabled preservation):\n  ${offenders.join("\n  ")}`,
    ).toHaveLength(0);
  });
});
