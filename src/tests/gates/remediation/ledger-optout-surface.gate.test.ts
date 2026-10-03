/**
 * Gate (remediation ledger-optout-surface): the ledger opt-out surface (D2).
 *
 * The immutable audit ledger ("účetní kniha") is split into two layers:
 *
 *   (1) The IN-DB hash chain — blockchain_audit_records with the BEFORE INSERT
 *       chain-link trigger (fn_blockchain_audit_chain_link) and the tamper
 *       guard (fn_blockchain_audit_guard). This layer is the accounting book
 *       and is ALWAYS ON: it records every governance/aisha token movement
 *       deterministically and is never optional.
 *
 *   (2) The ON-CHAIN / PERSONAL anchoring — pushing a member's activity to the
 *       Cosmos chain (svc-blockchain dispatch/outbox) and binding it to that
 *       member's personal wallet. THIS is the only layer a member (or an
 *       instance operator) may opt out of, for GDPR / data-minimisation.
 *
 * D2 (LOCKED) therefore requires an opt-out surface that gates ONLY layer (2)
 * while layer (1) stays unconditional:
 *
 *   (a) A per-member `ledger_participation` setting: a self-RLS RPC
 *       (SECURITY INVOKER, self-scoped via auth.uid(), REVOKE PUBLIC / GRANT
 *       authenticated — mirroring update_my_cosmos_address.sql) plus a backing
 *       column/table under aisha/db/sql/tables.
 *
 *   (b) A per-instance `LEDGER_ENABLED` flag that is READ where the on-chain /
 *       personal anchor decision is made — either at the
 *       fn_queue_blockchain_sync branch point (an in-DB `ledger_enabled` GUC
 *       and/or a `ledger_participation` membership check) OR on the dispatch
 *       path (svc-blockchain reads LEDGER_ENABLED before broadcasting).
 *
 *   (c) The in-DB chain-link / tamper-guard TRIGGERS remain UNCONDITIONAL —
 *       they must NOT be gated by the opt-out flag (no WHEN(...) clause, no
 *       reference to ledger_enabled / ledger_participation / opt_out). Opting
 *       out must never stop the book from recording, and (per D2) must never
 *       mutate an existing chain row.
 *
 * KNOWN-RED at authoring time (branch feat/service-build-fixes): grepping for
 * ledger_participation / ledger_enabled / opt_out across aisha/db/sql, src and
 * services returns nothing — the opt-out surface does not exist yet, so tests
 * (a) and (b) fail. Test (c) already passes and must STAY passing: the fix adds
 * the opt-out surface WITHOUT gating the chain triggers. Do NOT weaken this
 * gate — build the surface so it turns green.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const ROOT = process.cwd();
const SQL_ROOT = join(ROOT, "aisha/db/sql");
const TABLES_DIR = join(SQL_ROOT, "tables");

const CHAIN_LINK_TRIGGER = join(
  SQL_ROOT,
  "triggers/trg_blockchain_audit_chain_link.sql",
);
const GUARD_TRIGGER = join(SQL_ROOT, "triggers/trg_blockchain_audit_guard.sql");
const QUEUE_FN = join(SQL_ROOT, "functions/fn_queue_blockchain_sync.sql");

/** svc-blockchain surfaces where the on-chain anchor decision can be gated. */
const DISPATCH_SURFACES = [
  "services/svc-blockchain/src/routes/dispatch.ts",
  "services/svc-blockchain/src/routes/ledger-sync.ts",
  "services/svc-blockchain/src/config.ts",
].map((p) => join(ROOT, p));

/** Recursively collect every .sql file under a directory. */
function sqlFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...sqlFilesUnder(full));
    else if (entry.endsWith(".sql")) out.push(full);
  }
  return out;
}

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

/** Strip SQL line comments so a comment mentioning a token is not a match. */
function stripSqlComments(src: string): string {
  return src
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

describe("ledger opt-out surface (D2)", () => {
  test("(a) per-member ledger_participation: self-RLS RPC + backing column/table exists", () => {
    // Backing store: a table under aisha/db/sql/tables declares the
    // ledger_participation column (or a dedicated ledger_participation table).
    const tableFiles = sqlFilesUnder(TABLES_DIR);
    const backingStore = tableFiles.filter((f) =>
      /ledger_participation/i.test(stripSqlComments(read(f))),
    );
    expect(
      backingStore.map((f) => basename(f)),
      "no backing store: a table under aisha/db/sql/tables must declare a " +
        "ledger_participation column (or a ledger_participation table with RLS)",
    ).not.toEqual([]);

    // Self-RLS RPC: SECURITY INVOKER, self-scoped via auth.uid(), writes the
    // ledger_participation setting, REVOKE PUBLIC / GRANT authenticated —
    // mirroring update_my_cosmos_address.sql.
    const fnFiles = sqlFilesUnder(join(SQL_ROOT, "functions"));
    const selfRlsRpc = fnFiles.filter((f) => {
      const src = stripSqlComments(read(f));
      if (!/ledger_participation/i.test(src)) return false;
      if (!/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(src)) return false;
      return (
        /SECURITY\s+INVOKER/i.test(src) &&
        /auth\.uid\s*\(\s*\)/i.test(src) &&
        /REVOKE\s+ALL\s+ON\s+FUNCTION[\s\S]+FROM\s+PUBLIC/i.test(src) &&
        /GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]+TO\s+authenticated/i.test(src)
      );
    });
    expect(
      selfRlsRpc.map((f) => basename(f)),
      "no self-RLS opt-out RPC: a function under aisha/db/sql/functions must " +
        "let a member set their own ledger_participation — SECURITY INVOKER, " +
        "self-scoped via auth.uid(), REVOKE PUBLIC / GRANT authenticated " +
        "(mirror update_my_cosmos_address.sql)",
    ).not.toEqual([]);
  });

  test("(b) per-instance LEDGER_ENABLED flag is read at the on-chain anchor decision point", () => {
    // The anchor decision may be gated in-DB (fn_queue_blockchain_sync branch
    // point reads a ledger_enabled GUC and/or a ledger_participation check) OR
    // on the dispatch path (svc-blockchain reads the LEDGER_ENABLED env flag).
    const queueSrc = stripSqlComments(read(QUEUE_FN));
    const gatedInDb =
      /ledger_enabled/i.test(queueSrc) ||
      /ledger_participation/i.test(queueSrc);

    const gatedInDispatch = DISPATCH_SURFACES.some((f) =>
      /LEDGER_ENABLED/.test(read(f)),
    );

    expect(
      gatedInDb || gatedInDispatch,
      "the on-chain / personal anchor decision must read the opt-out flag: " +
        "either fn_queue_blockchain_sync gates on a ledger_enabled GUC / " +
        "ledger_participation membership check, or svc-blockchain reads the " +
        "LEDGER_ENABLED env flag before dispatching to the chain",
    ).toBe(true);
  });

  test("(c) in-DB chain-link + tamper-guard triggers remain unconditional (NOT gated by the opt-out flag)", () => {
    // The book (layer 1) is always on. The opt-out flag must gate only the
    // on-chain anchoring (layer 2) — never the chain-link / guard triggers.
    for (const path of [CHAIN_LINK_TRIGGER, GUARD_TRIGGER]) {
      const raw = read(path);
      expect(raw.length, `${basename(path)} must exist`).toBeGreaterThan(0);
      const src = stripSqlComments(raw);

      expect(
        /\bWHEN\s*\(/i.test(src),
        `${basename(path)} must NOT carry a WHEN(...) clause — the in-DB ` +
          `chain must fire for every row, unconditionally`,
      ).toBe(false);

      expect(
        /ledger_enabled|ledger_participation|opt_out/i.test(src),
        `${basename(path)} must NOT reference the opt-out flag — opting out ` +
          `of on-chain anchoring must never gate the immutable in-DB book`,
      ).toBe(false);
    }
  });
});
