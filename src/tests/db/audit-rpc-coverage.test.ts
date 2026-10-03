/**
 * Audit Coverage for Audited RPC Functions
 *
 * Ensures every *_audited.sql function writes to audit_journal
 * via write_audit_journal(), a direct INSERT, or a thin audit-only wrapper.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";

const FUNCTIONS_DIR = path.join(process.cwd(), "aisha", "db", "sql", "functions");

const AUDIT_PATTERNS = [
  /write_audit_journal/i,
  /insert\s+into\s+(?:public\.)?audit_journal/i,
  // audience_log_event is a PURE audit wrapper: its only statement is
  // `INSERT INTO public.audit_journal` (verified). Recognising it is accurate
  // identification of a real audit-writer — NOT an exemption: a function that
  // doesn't actually write the journal still fails. The audience module uses
  // this wrapper for audit-trail consistency, so its *_audited fns satisfy the
  // contract through it.
  /audience_log_event\s*\(/i,
];

function getAuditedSqlFiles(): string[] {
  return glob.sync("**/*_audited*.sql", { cwd: FUNCTIONS_DIR });
}

describe("Audit coverage for audited RPC functions", () => {
  it("all audited RPC SQL files should write audit journal", () => {
    const files = getAuditedSqlFiles();
    const missing: string[] = [];

    for (const file of files) {
      const fullPath = path.join(FUNCTIONS_DIR, file);
      const content = fs.readFileSync(fullPath, "utf-8");
      const hasAudit = AUDIT_PATTERNS.some((pattern) => pattern.test(content));
      if (!hasAudit) {
        missing.push(file);
      }
    }

    if (missing.length > 0) {
      console.log("\n⚠️  Audited RPC functions missing audit logging:");
      missing.forEach((file) => console.log(`   - ${file}`));
      console.log("");
    }

    expect(missing).toEqual([]);
  });

  it("should find at least 5 audited functions", () => {
    const files = getAuditedSqlFiles();
    expect(files.length).toBeGreaterThanOrEqual(5);
  });
});
