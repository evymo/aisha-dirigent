/**
 * Gate: audit_journal actor must never be a FK-violating sentinel.
 *
 * audit_journal.user_id is a nullable FK to aisha_auth.users (ON DELETE SET NULL).
 * Several functions logged failures with user_id = '00000000-…0000' (directly or
 * via COALESCE(auth.uid(), '00000000-…0000')). That zero-uuid is NOT a real
 * aisha_auth.users row, so the audit INSERT violated audit_journal_user_id_fkey —
 * turning every "log the failure" path into a hard failure of the triggering
 * statement (webhook hiccups, self-repair, revenue audits, sync-auth, KC role
 * sync). NULL is FK-safe; the correct actor for a system/service context is
 * auth.uid() (which is NULL there), never a fabricated sentinel.
 *
 * This gate keeps the class eradicated: no INSERT INTO audit_journal may carry the
 * zero-uuid sentinel in its VALUES. (Non-audit uses of the sentinel — NULL-safe
 * WHERE/index keys, jsonb display values — are allowed and not matched.)
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SQL_ROOT = join(process.cwd(), "aisha/db/sql");
const SENTINEL = "00000000-0000-0000-0000-000000000000";

function walkSql(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkSql(full));
    else if (entry.endsWith(".sql")) out.push(full);
  }
  return out;
}

/**
 * Find INSERT INTO audit_journal statements and return those whose VALUES clause
 * (the text from the INSERT up to the statement-terminating `);`) contains the
 * zero-uuid sentinel.
 */
function findSentinelAudits(sql: string): string[] {
  const hits: string[] = [];
  const re = /insert\s+into\s+(?:public\.)?audit_journal\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    // window = from the INSERT to the next `);` (close of the VALUES tuple),
    // bounded so a runaway never scans the whole file.
    const start = m.index;
    const closeIdx = sql.indexOf(");", start);
    const end = closeIdx === -1 ? Math.min(start + 800, sql.length) : closeIdx;
    const window = sql.slice(start, end);
    if (window.includes(SENTINEL)) {
      const line = sql.slice(0, start).split("\n").length;
      hits.push(`line ${line}`);
    }
  }
  return hits;
}

describe("audit_journal actor — no FK-violating sentinel", () => {
  test("no INSERT INTO audit_journal uses the zero-uuid sentinel as actor", () => {
    const offenders: string[] = [];
    for (const file of walkSql(SQL_ROOT)) {
      const sql = readFileSync(file, "utf-8");
      const hits = findSentinelAudits(sql);
      if (hits.length) {
        offenders.push(`${file.replace(process.cwd() + "/", "")}: ${hits.join(", ")}`);
      }
    }
    expect(
      offenders,
      `audit_journal inserts must use auth.uid() (nullable), not the FK-violating ` +
        `'${SENTINEL}' sentinel:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
