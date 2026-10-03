/**
 * Audited Function Integrity Gate Test
 *
 * Validates that SQL functions with the `_audited` suffix convention
 * actually contain audit trail logging. The `_audited` suffix is a
 * contract — it tells callers (hooks, components, code reviewers)
 * that the function logs sensitive data access to audit_journal.
 *
 * Checks:
 * 1. Every *_audited.sql function contains write_audit_journal() or INSERT INTO audit_journal
 * 2. Every *_audited.sql function uses SECURITY DEFINER (audit must run as definer, not invoker)
 * 3. Every *_audited.sql function has SET search_path TO 'public' (SECURITY DEFINER requirement)
 * 4. Every *_audited.sql function has REVOKE ALL + explicit GRANT
 *
 * Run: npm run test:gates -- src/tests/gates/audited-function-integrity.gate.test.ts
 *
 * @module
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const SQL_FUNCTIONS_DIR = path.join(ROOT, "aisha/db/sql/functions");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AuditedFunctionInfo {
  name: string;
  filePath: string;
  hasAuditCall: boolean;
  hasSecurityDefiner: boolean;
  hasSearchPath: boolean;
  hasRevokeAll: boolean;
  hasGrantExecute: boolean;
}

function analyzeAuditedFunction(filePath: string): AuditedFunctionInfo {
  const content = fs.readFileSync(filePath, "utf-8");
  const name = path.basename(filePath, ".sql");

  return {
    name,
    filePath: path.relative(ROOT, filePath),
    hasAuditCall:
      /write_audit_journal\s*\(/i.test(content) ||
      /INSERT\s+INTO\s+(?:public\.)?audit_journal/i.test(content) ||
      /PERFORM\s+(?:public\.)?write_audit_journal/i.test(content) ||
      // audience_log_event is a PURE audit wrapper (its only statement is
      // INSERT INTO audit_journal — verified). Recognising it confirms the
      // audit contract is met via the audience module's canonical helper; it is
      // NOT an exemption (a non-auditing function still fails this check).
      /(?:PERFORM\s+)?(?:public\.)?audience_log_event\s*\(/i.test(content),
    hasSecurityDefiner: /SECURITY\s+DEFINER/i.test(content),
    hasSearchPath: /SET\s+search_path\s+(TO\s+'public'|=\s*'?public'?)/i.test(content),
    hasRevokeAll: /REVOKE\s+ALL\s+ON\s+FUNCTION/i.test(content),
    hasGrantExecute: /GRANT\s+EXECUTE\s+ON\s+FUNCTION/i.test(content),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Audited Function Integrity (_audited suffix contract)", () => {
  let auditedFunctions: AuditedFunctionInfo[];

  beforeAll(() => {
    if (!fs.existsSync(SQL_FUNCTIONS_DIR)) {
      auditedFunctions = [];
      return;
    }

    const auditedFiles = fs.readdirSync(SQL_FUNCTIONS_DIR)
      .filter((f) => f.endsWith("_audited.sql"));

    auditedFunctions = auditedFiles.map((f) =>
      analyzeAuditedFunction(path.join(SQL_FUNCTIONS_DIR, f)),
    );
  });

  it("finds a non-trivial number of _audited functions", () => {
    expect(
      auditedFunctions.length,
      "Expected at least 50 _audited SQL functions in SoT",
    ).toBeGreaterThan(50);
  });

  it("every _audited function contains audit_journal logging", () => {
    const violations = auditedFunctions
      .filter((fn) => !fn.hasAuditCall)
      .map((fn) => `${fn.filePath} — no write_audit_journal() or INSERT INTO audit_journal`);

    expect(
      violations,
      `_audited functions WITHOUT audit logging (breaking the _audited contract):\n${violations.join("\n")}`,
    ).toHaveLength(0);
  });

  it("every _audited function uses SECURITY DEFINER", () => {
    const violations = auditedFunctions
      .filter((fn) => !fn.hasSecurityDefiner)
      .map((fn) => `${fn.filePath} — missing SECURITY DEFINER`);

    expect(
      violations,
      `_audited functions WITHOUT SECURITY DEFINER:\n${violations.join("\n")}`,
    ).toHaveLength(0);
  });

  it("every _audited function has SET search_path TO 'public'", () => {
    const violations = auditedFunctions
      .filter((fn) => fn.hasSecurityDefiner && !fn.hasSearchPath)
      .map((fn) => `${fn.filePath} — SECURITY DEFINER without SET search_path`);

    expect(
      violations,
      `_audited SECURITY DEFINER functions without SET search_path:\n${violations.join("\n")}`,
    ).toHaveLength(0);
  });

  // Obecné orákulum šifrování: volá ho JEN definer cesta (set_data_source_secrets,
  // get_plugin_runtime_config), žádná role. Pro ně platí PŘÍSNĚJŠÍ smlouva než výše:
  // REVOKE ALL a ŽÁDNÝ grant — explicitní správa oprávnění je tu „nikdo". Tentýž
  // seznam hlídá tajemstvi-bez-grantu-a-bez-kopie.gate (včetně mutačního testu);
  // bez tohoto rozlišení by se ty dvě brány navzájem vylučovaly.
  const BEZ_GRANTU = new Set(["aisha_decrypt_column_audited", "aisha_encrypt_column_audited"]);

  it("obecné orákulum (_audited bez volající role) má REVOKE ALL a ŽÁDNÝ GRANT", () => {
    const nalezene = auditedFunctions.filter((fn) => BEZ_GRANTU.has(fn.name));
    expect(nalezene.map((fn) => fn.name).sort(), "seznam míří na existující soubory").toEqual(
      [...BEZ_GRANTU].sort(),
    );
    const violations = nalezene
      .filter((fn) => !fn.hasRevokeAll || fn.hasGrantExecute)
      .map((fn) => `${fn.filePath} — ${fn.hasGrantExecute ? "má GRANT EXECUTE" : "chybí REVOKE ALL"}`);
    expect(violations, `orákulum šifrování nesmí volat žádná role:\n${violations.join("\n")}`)
      .toHaveLength(0);
  });

  it("every _audited function has REVOKE ALL + GRANT EXECUTE", () => {
    const violations = auditedFunctions
      .filter((fn) => !BEZ_GRANTU.has(fn.name))
      .filter((fn) => !fn.hasRevokeAll || !fn.hasGrantExecute)
      .map((fn) => {
        const missing: string[] = [];
        if (!fn.hasRevokeAll) missing.push("REVOKE ALL");
        if (!fn.hasGrantExecute) missing.push("GRANT EXECUTE");
        return `${fn.filePath} — missing: ${missing.join(", ")}`;
      });

    expect(
      violations,
      `_audited functions with incomplete permission management:\n${violations.join("\n")}`,
    ).toHaveLength(0);
  });
});
