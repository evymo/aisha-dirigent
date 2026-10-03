/**
 * LEDGER-AUDIT-JOURNAL — audit_journal immutability + continuous verification gate
 * (remediation, test-first)
 *
 * CONTEXT: The immutable ledger has two audit surfaces:
 *   1. blockchain_audit_records — a real hash chain (previous_hash) with a
 *      chain-link trigger (fn_blockchain_audit_chain_link) AND a tamper guard
 *      (fn_blockchain_audit_guard: chain cols immutable, DELETE/TRUNCATE forbidden).
 *   2. audit_journal — the SECOND surface used by ~200 *_audited RPCs
 *      (write_audit_journal). Today it is per-row hashed ONLY
 *      (blockchain_hash column, v2 deterministic) with NO chain link and,
 *      critically, NO tamper guard: rows can be UPDATEd (including the hash
 *      column) or DELETEd/TRUNCATEd with nothing forbidding it, so the
 *      "audit" surface most callers actually write to is mutable.
 *
 * CONTRACT (post-fix, this gate asserts the CORRECT end state):
 *   (a) audit_journal is tamper-evident like blockchain_audit_records — EITHER
 *       a previous_hash chain column + a chain-link trigger ON audit_journal,
 *       OR a tamper-guard trigger ON audit_journal that (i) fires BEFORE
 *       UPDATE/DELETE/TRUNCATE and (ii) is backed by a guard function that
 *       forbids DELETE and TRUNCATE and forbids mutation of the hash column
 *       (blockchain_hash / previous_hash). A real SoT trigger file under
 *       aisha/db/sql/triggers/** referencing audit_journal must exist.
 *   (b) fn_verify_audit_chain has a SCHEDULED caller wired into the running
 *       system — an n8n workflow with a schedule/cron trigger that invokes it,
 *       OR a pg_cron (cron.schedule) / RPC caller in SoT — NOT just the pgTAP
 *       test in aisha/db/tests/schema/21 (that only proves the fn works in CI,
 *       it never runs against prod data on a schedule).
 *
 * KNOWN-RED (at authoring, HEAD feat/service-build-fixes):
 *   (a) audit_journal has only INSERT-side triggers
 *       (trigger_audit_journal_set_action, trg_audit_journal_to_story_entry) —
 *       no chain-link, no tamper guard → RED.
 *   (b) fn_verify_audit_chain is referenced only in aisha/db/{heals,baseline}
 *       and aisha/db/tests/schema/21 — zero scheduled callers in n8n/, no
 *       pg_cron, no service → RED.
 *   => 2 sub-gaps RED. Post-fix each sub-gap flips GREEN.
 *
 * STATIC / OFFLINE: walks aisha/db/sql/**, aisha/db/tests/**, n8n/workflows/**,
 * services/**. No DB, no network, no new deps. Consistent with the sibling
 * remediation gates.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();

const SQL_TRIGGERS_DIR = path.join(ROOT, "aisha", "db", "sql", "triggers");
const SQL_FUNCTIONS_DIR = path.join(ROOT, "aisha", "db", "sql", "functions");
const SQL_TABLES_DIR = path.join(ROOT, "aisha", "db", "sql", "tables");
const SQL_ROOT = path.join(ROOT, "aisha", "db", "sql");
const N8N_WORKFLOWS_DIR = path.join(ROOT, "n8n", "workflows");
const SERVICES_DIR = path.join(ROOT, "services");

const TABLE = "audit_journal";
const VERIFY_FN = "verify_audit_chain"; // matches fn_verify_audit_chain

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function readIfExists(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
}

function listFiles(dir: string, ext: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((e) => e.endsWith(ext))
      .map((e) => path.join(dir, e))
      .sort();
  } catch {
    return [];
  }
}

/** Recursively walk a directory, returning files matching one of `exts`. */
function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      out.push(...walk(full, exts));
    } else if (exts.some((x) => entry.name.endsWith(x))) {
      out.push(full);
    }
  }
  return out.sort();
}

const rx = (s: string) => new RegExp(s, "i");
const tableRx = rx(`\\b${TABLE}\\b`);

// ---------------------------------------------------------------------------
// (a) tamper-evidence for audit_journal
// ---------------------------------------------------------------------------

interface TriggerFile {
  file: string;
  text: string;
}

/** Trigger SoT files that declare a trigger ON public.audit_journal. */
function auditJournalTriggerFiles(): TriggerFile[] {
  const out: TriggerFile[] = [];
  for (const file of listFiles(SQL_TRIGGERS_DIR, ".sql")) {
    const text = readIfExists(file) ?? "";
    // A trigger targeting audit_journal: `... ON [public.]audit_journal`.
    if (rx(`on\\s+(public\\.)?${TABLE}\\b`).test(text)) {
      out.push({ file, text });
    }
  }
  return out;
}

/** Extract the trigger function name from `EXECUTE (FUNCTION|PROCEDURE) fn(...)`. */
function triggerFn(text: string): string | null {
  const m = text.match(/execute\s+(?:function|procedure)\s+([a-z0-9_.]+)\s*\(/i);
  return m ? m[1].replace(/^public\./i, "") : null;
}

function fnBody(fnName: string): string | null {
  return readIfExists(path.join(SQL_FUNCTIONS_DIR, `${fnName}.sql`));
}

/** Guard fn forbids DELETE and TRUNCATE and forbids mutating a hash column. */
function isTamperGuardFn(body: string): boolean {
  const forbidsDelete = /tg_op\s*=\s*'delete'/i.test(body) && /raise\s+exception/i.test(body);
  const forbidsTruncate =
    /tg_op\s*=\s*'truncate'/i.test(body) && /raise\s+exception/i.test(body);
  // Immutable hash column: the guard must reference a hash column and reject
  // its mutation (IS DISTINCT FROM ... -> RAISE).
  const guardsHashColumn =
    /(blockchain_hash|previous_hash|record_hash)/i.test(body) &&
    /is\s+distinct\s+from/i.test(body) &&
    /raise\s+exception/i.test(body);
  return forbidsDelete && forbidsTruncate && guardsHashColumn;
}

/**
 * Guard path: a BEFORE UPDATE/DELETE (and/or TRUNCATE) trigger on audit_journal
 * backed by a guard function with the immutability semantics above.
 */
function tamperGuardResult(): { ok: boolean; detail: string } {
  const candidates = auditJournalTriggerFiles().filter((t) =>
    /before\s+[^;]*\b(update|delete|truncate)\b/i.test(t.text),
  );
  if (candidates.length === 0) {
    return {
      ok: false,
      detail:
        "no BEFORE UPDATE/DELETE/TRUNCATE trigger on audit_journal (only INSERT-side triggers exist)",
    };
  }
  for (const cand of candidates) {
    const fn = triggerFn(cand.text);
    if (!fn) continue;
    const body = fnBody(fn);
    if (body && isTamperGuardFn(body)) {
      return {
        ok: true,
        detail: `${path.relative(ROOT, cand.file)} -> ${fn}() (guards DELETE/TRUNCATE + hash column)`,
      };
    }
  }
  return {
    ok: false,
    detail:
      "found a BEFORE UPDATE/DELETE trigger on audit_journal, but its function does not forbid DELETE+TRUNCATE and freeze the hash column",
  };
}

/**
 * Chain path: audit_journal has a previous_hash chain column AND a chain-link
 * trigger (BEFORE INSERT) on audit_journal that computes/sets the chained hash.
 */
function chainResult(): { ok: boolean; detail: string } {
  const tableText = readIfExists(path.join(SQL_TABLES_DIR, `${TABLE}.sql`)) ?? "";
  const hasPrevHashColumn = /^\s*previous_hash\s+/im.test(tableText);
  if (!hasPrevHashColumn) {
    return { ok: false, detail: "audit_journal table has no previous_hash chain column" };
  }
  const chainTrigger = auditJournalTriggerFiles().find((t) => {
    if (!/before\s+insert/i.test(t.text)) return false;
    const fn = triggerFn(t.text);
    if (!fn) return false;
    const body = fnBody(fn) ?? "";
    return /previous_hash/i.test(body) && /record_hash|chain|hash/i.test(body);
  });
  if (!chainTrigger) {
    return {
      ok: false,
      detail: "previous_hash column present but no chain-link BEFORE INSERT trigger on audit_journal",
    };
  }
  return {
    ok: true,
    detail: `chain column + ${path.relative(ROOT, chainTrigger.file)}`,
  };
}

// ---------------------------------------------------------------------------
// (b) scheduled caller of fn_verify_audit_chain
// ---------------------------------------------------------------------------

const SCHEDULE_NODE_RX = /(schedule|cron|interval)trigger/i;

/** n8n workflow that has a schedule/cron trigger AND references verify_audit_chain. */
function scheduledN8nCaller(): string | null {
  for (const file of listFiles(N8N_WORKFLOWS_DIR, ".json")) {
    const text = readIfExists(file) ?? "";
    if (!rx(VERIFY_FN).test(text)) continue;
    let doc: { nodes?: Array<{ type?: unknown }> };
    try {
      doc = JSON.parse(text);
    } catch {
      continue;
    }
    const hasSchedule = (doc.nodes ?? []).some(
      (n) => typeof n.type === "string" && SCHEDULE_NODE_RX.test(n.type),
    );
    if (hasSchedule) return path.relative(ROOT, file);
  }
  return null;
}

/** pg_cron schedule in SoT that invokes verify_audit_chain. */
function pgCronCaller(): string | null {
  for (const file of walk(SQL_ROOT, [".sql"])) {
    const text = readIfExists(file) ?? "";
    if (/cron\.schedule/i.test(text) && rx(VERIFY_FN).test(text)) {
      return path.relative(ROOT, file);
    }
  }
  return null;
}

/** A service that references verify_audit_chain (RPC/cron caller in app code). */
function serviceCaller(): string | null {
  for (const file of walk(SERVICES_DIR, [".ts", ".js", ".mjs"])) {
    const text = readIfExists(file) ?? "";
    if (rx(VERIFY_FN).test(text)) return path.relative(ROOT, file);
  }
  return null;
}

function scheduledVerifierResult(): { ok: boolean; detail: string; via: string | null } {
  const n8n = scheduledN8nCaller();
  if (n8n) return { ok: true, detail: `n8n scheduled workflow ${n8n}`, via: n8n };
  const cron = pgCronCaller();
  if (cron) return { ok: true, detail: `pg_cron schedule in ${cron}`, via: cron };
  const svc = serviceCaller();
  if (svc) return { ok: true, detail: `service caller ${svc}`, via: svc };
  return {
    ok: false,
    detail:
      "fn_verify_audit_chain has no scheduled caller: no n8n schedule/cron workflow invokes it, " +
      "no pg_cron schedule, no service caller — it is exercised ONLY by aisha/db/tests/schema/21 (pgTAP)",
    via: null,
  };
}

// ---------------------------------------------------------------------------
// gate
// ---------------------------------------------------------------------------

describe("LEDGER audit_journal immutability + continuous verification gate", () => {
  it("discovers the SoT surfaces to scan (sanity)", () => {
    // The table and the verifier fn must exist for this gate to be meaningful.
    expect(
      fs.existsSync(path.join(SQL_TABLES_DIR, `${TABLE}.sql`)),
      "audit_journal table SoT missing",
    ).toBe(true);
    expect(
      fs.existsSync(path.join(SQL_FUNCTIONS_DIR, "fn_verify_audit_chain.sql")),
      "fn_verify_audit_chain SoT missing",
    ).toBe(true);
    expect(auditJournalTriggerFiles().length).toBeGreaterThan(0);
  });

  it("(a) audit_journal is tamper-evident (chain-link OR tamper-guard trigger)", () => {
    const guard = tamperGuardResult();
    const chain = chainResult();
    const ok = guard.ok || chain.ok;
    expect(
      ok,
      "audit_journal is NOT tamper-evident. It needs EITHER a previous_hash chain " +
        "column + chain-link trigger, OR a tamper-guard trigger (BEFORE UPDATE/DELETE/" +
        "TRUNCATE) whose function forbids DELETE+TRUNCATE and freezes the hash column, " +
        "mirroring fn_blockchain_audit_guard on blockchain_audit_records.\n" +
        `  guard path: ${guard.detail}\n` +
        `  chain path: ${chain.detail}`,
    ).toBe(true);
  });

  it("(b) fn_verify_audit_chain has a SCHEDULED caller (not just pgTAP)", () => {
    const res = scheduledVerifierResult();
    expect(
      res.ok,
      "Continuous ledger verification is not wired. A scheduled caller of " +
        "fn_verify_audit_chain must exist (n8n schedule/cron workflow, pg_cron, or " +
        "service), so tamper is detected against live data — not only in CI.\n" +
        `  ${res.detail}`,
    ).toBe(true);
  });

  it("summarizes both sub-gaps for the remediation report", () => {
    const guard = tamperGuardResult();
    const chain = chainResult();
    const tamperEvident = guard.ok || chain.ok;
    const verifier = scheduledVerifierResult();

    const open: string[] = [];
    if (!tamperEvident) open.push("(a) audit_journal not tamper-evident");
    if (!verifier.ok) open.push("(b) no scheduled fn_verify_audit_chain caller");

    expect(
      open.length,
      `LEDGER-AUDIT-JOURNAL open sub-gaps (${open.length}/2):\n  - ${open.join("\n  - ")}`,
    ).toBe(0);
  });
});
