/**
 * Gate (remediation PLG-02-resolveplugin-status):
 *
 * CONTRACT between the plugin catalog RPC and the sandbox resolver.
 *
 *   aisha/db/sql/functions/get_available_plugins.sql  (the producer)
 *   services/svc-plugin-system/src/sandbox.ts :: resolvePlugin  (the consumer)
 *
 * get_available_plugins ONLY ever returns rows whose status is in the set
 * declared by its `WHERE pc.status IN (...)` clause — today ('canary','ga').
 * It never emits a row with status 'active'.
 *
 * resolvePlugin post-filters that result set by status. For a plugin to
 * resolve at all, the status literals resolvePlugin accepts MUST be the SAME
 * set the SQL emits. If they diverge, `plugins.find(...)` matches nothing and
 * EVERY plugin lookup returns null -> every plugin 404s.
 *
 * KNOWN-RED at authoring time (branch feat/remediation @ 569c5ffd):
 *   - sandbox.ts filters `p.status === 'active'`
 *   - the SQL only ever returns 'canary' / 'ga'
 *   => intersection is empty => resolvePlugin always returns null.
 *
 * Second facet (also KNOWN-RED): field-mapping mismatch. The SQL projects the
 * artifact identity as `artifact_sha256` / `artifact_url`, but sandbox.ts
 * consumes `sha256` / `entry`, which the RPC never emits. resolvePlugin must
 * bridge the real SQL field names (either by reading them or mapping them),
 * otherwise the SHA-256 integrity check downstream compares against undefined.
 *
 * After the fix (resolvePlugin accepts the SQL status set and reads the SQL
 * artifact field names) this gate goes green. Do NOT relax the assertions to
 * the buggy state and do NOT lower the SQL WHERE clause to include 'active' —
 * fix the consumer to match the producer's real contract.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SQL_PATH = "aisha/db/sql/functions/get_available_plugins.sql";
const TS_PATH = "services/svc-plugin-system/src/sandbox.ts";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

/** Strip `//` and block comments so commented-out code never satisfies a check. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

/** Extract the status set from the SQL `WHERE ... status IN ('a','b',...)`. */
function sqlStatusSet(sql: string): Set<string> {
  const m = sql.match(/status\s+IN\s*\(([^)]*)\)/i);
  if (!m) throw new Error(`Could not find 'status IN (...)' in ${SQL_PATH}`);
  const set = new Set<string>();
  for (const lit of m[1].matchAll(/'([^']+)'/g)) set.add(lit[1]);
  return set;
}

/** Slice out the body of the resolvePlugin function. */
function resolvePluginBody(ts: string): string {
  const start = ts.indexOf("function resolvePlugin");
  if (start === -1) throw new Error(`resolvePlugin not found in ${TS_PATH}`);
  // Take until the next top-level `export function` / `export async function`
  // (resolvePlugin is the first exported fn in the file).
  const rest = ts.slice(start + "function resolvePlugin".length);
  const next = rest.search(/\nexport\s+(?:async\s+)?function\b/);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * Extract the status literals resolvePlugin compares against. We collect any
 * quoted string that shares a statement with the token `status` (equality
 * check, array `.includes(p.status)`, `new Set([...]).has(p.status)`, etc.),
 * so the check is agnostic to how the fix expresses the filter.
 */
function tsStatusSet(body: string): Set<string> {
  const set = new Set<string>();
  // A quoted literal appearing to the LEFT of `status` in the same statement.
  for (const m of body.matchAll(/['"]([^'"]+)['"][^;{}\n]*?\bstatus\b/g)) set.add(m[1]);
  // A quoted literal appearing to the RIGHT of `status` in the same statement.
  for (const m of body.matchAll(/\bstatus\b[^;{}\n]*?['"]([^'"]+)['"]/g)) set.add(m[1]);
  return set;
}

describe("plugin resolve status contract (get_available_plugins <-> resolvePlugin)", () => {
  const sql = stripComments(read(SQL_PATH));
  const ts = stripComments(read(TS_PATH));
  const sqlSet = sqlStatusSet(sql);
  const tsSet = tsStatusSet(resolvePluginBody(ts));

  test("SQL emits a non-empty status set that never includes 'active'", () => {
    expect(sqlSet.size).toBeGreaterThan(0);
    // Sanity: the producer really does exclude 'active' (the value the buggy
    // consumer filters on). If this ever changes, the whole premise moves.
    expect([...sqlSet]).not.toContain("active");
  });

  test("resolvePlugin accepts exactly the status set the SQL returns (no 'active' requirement)", () => {
    const sqlArr = [...sqlSet].sort();
    const tsArr = [...tsSet].sort();

    // Every status the SQL can emit must be accepted by resolvePlugin, else
    // those plugins can never resolve.
    const unaccepted = sqlArr.filter((s) => !tsSet.has(s));
    expect(
      unaccepted,
      `resolvePlugin rejects statuses that get_available_plugins actually returns ` +
        `(these plugins would 404): ${unaccepted.join(", ")}. ` +
        `SQL emits [${sqlArr.join(", ")}]; resolvePlugin accepts [${tsArr.join(", ")}].`,
    ).toEqual([]);

    // And resolvePlugin must not filter on a status the SQL never emits (e.g.
    // 'active'), which would silently drop every real row.
    const phantom = tsArr.filter((s) => !sqlSet.has(s));
    expect(
      phantom,
      `resolvePlugin filters on status value(s) get_available_plugins never emits ` +
        `(every lookup returns null): ${phantom.join(", ")}. ` +
        `SQL emits [${sqlArr.join(", ")}].`,
    ).toEqual([]);
  });

  test("resolvePlugin reads the artifact fields the SQL actually projects (artifact_sha256 / artifact_url)", () => {
    // The RPC projects `artifact_sha256` and `artifact_url`; a consumer that
    // reads `sha256` / `entry` gets undefined and the integrity check breaks.
    for (const field of ["artifact_sha256", "artifact_url"]) {
      expect(sql, `expected SQL to project ${field}`).toContain(field);
    }
    const body = resolvePluginBody(ts);
    for (const field of ["artifact_sha256", "artifact_url"]) {
      expect(
        new RegExp(`\\b${field}\\b`).test(body),
        `resolvePlugin must bridge the SQL field '${field}' (read it or map it) ` +
          `so the manifest carries the real artifact identity; it currently does not.`,
      ).toBe(true);
    }
  });
});
