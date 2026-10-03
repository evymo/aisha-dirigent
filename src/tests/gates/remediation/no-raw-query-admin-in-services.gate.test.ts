/**
 * Gate (remediation SVC-05): no service route may execute inline SQL through the
 * generic escape hatch `rpcService('raw_query_admin', ...)`, and every RPC name a
 * service invokes must be backed by a real SQL function source file.
 *
 * Why this exists:
 *  1. `raw_query_admin` is a raw-SQL admin bypass. A service route that assembles
 *     a SQL string and ships it through `raw_query_admin` sidesteps the
 *     SECURITY DEFINER + REVOKE/GRANT + audit-provenance contract that every real
 *     RPC enforces, and is a first-class SQL-injection / privilege-escalation
 *     surface (CLAUDE.md "Validate All Input" / "Least Privilege"). Route code
 *     must call a NAMED, reviewed RPC instead.
 *  2. A service that calls `rpcService('some_rpc', ...)` for an RPC that has no
 *     `aisha/db/sql/functions/<name>.sql` source will fail at runtime with
 *     PGRST202 (swallowed) — a latent broken write path. Every service-invoked
 *     RPC must exist as a function source file.
 *
 * KNOWN-RED at authoring time (branch feat/remediation, HEAD 569c5ffd):
 *   services/svc-github-app/src/routes/webhook-bridge.ts
 *     - calls rpcService('raw_query_admin', ...) 3× (lines 53, 96, 120)
 *     - calls rpcService('upsert_github_app_repositories', ...)   -> NO sql file
 *     - calls rpcService('deactivate_github_app_repositories', ...) -> NO sql file
 *
 * After the fix (replace the 3 raw_query_admin call sites with named RPCs and add
 * the two missing github-app repo function sources) this gate goes green. Do NOT
 * allowlist offenders — write the RPCs. The allowlists below are reserved only for
 * provably-legitimate exceptions and are justified in-comment.
 */
import { describe, test, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SERVICES_DIR = join(ROOT, "services");
const FUNCTIONS_DIR = join(ROOT, "aisha", "db", "sql", "functions");

/**
 * RPC names that are NOT backed by a `functions/<name>.sql` file for a
 * legitimate reason (e.g. PostgREST built-ins). Justify each entry in-comment.
 * `raw_query_admin` is deliberately NOT here — its use is banned outright by the
 * first assertion, so it must never appear as an exempted "existing" RPC.
 */
const RPC_EXISTENCE_ALLOWLIST = new Set<string>([]);

/** Recursively collect *.ts (excluding *.d.ts and test files) under a dir. */
function walkTs(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === "build") continue;
      walkTs(full, acc);
    } else if (
      entry.endsWith(".ts") &&
      !entry.endsWith(".d.ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".spec.ts")
    ) {
      acc.push(full);
    }
  }
  return acc;
}

/** Strip `//` and block comments so a commented-out mention doesn't count. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

const serviceTsFiles = existsSync(SERVICES_DIR) ? walkTs(SERVICES_DIR) : [];

/** All `rpcService('name'` invocations across the service tree. */
function rpcServiceCalls(): Array<{ file: string; rpc: string }> {
  const calls: Array<{ file: string; rpc: string }> = [];
  const re = /rpcService\(\s*['"`]([a-zA-Z0-9_]+)['"`]/g;
  for (const file of serviceTsFiles) {
    const src = stripComments(readFileSync(file, "utf-8"));
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      calls.push({ file: file.slice(ROOT.length + 1), rpc: m[1] });
    }
  }
  return calls;
}

describe("SVC-05: no raw_query_admin + all service RPCs are backed by SQL files", () => {
  test("no service invokes rpcService('raw_query_admin', ...)", () => {
    expect(serviceTsFiles.length).toBeGreaterThan(0);

    const offenders = rpcServiceCalls()
      .filter((c) => c.rpc === "raw_query_admin")
      .map((c) => c.file);

    expect(
      offenders,
      `Service route files executing inline SQL via rpcService('raw_query_admin') ` +
        `(replace with a named, audited RPC): ${offenders.join(", ") || "none"}`,
    ).toEqual([]);
  });

  test("every RPC a service calls exists as aisha/db/sql/functions/<name>.sql", () => {
    expect(existsSync(FUNCTIONS_DIR)).toBe(true);

    const missing = new Map<string, string[]>(); // rpc -> caller files
    for (const { file, rpc } of rpcServiceCalls()) {
      if (rpc === "raw_query_admin") continue; // banned by the assertion above
      if (RPC_EXISTENCE_ALLOWLIST.has(rpc)) continue;
      if (!existsSync(join(FUNCTIONS_DIR, `${rpc}.sql`))) {
        const arr = missing.get(rpc) ?? [];
        if (!arr.includes(file)) arr.push(file);
        missing.set(rpc, arr);
      }
    }

    const report = [...missing.entries()]
      .map(([rpc, files]) => `${rpc} (called by ${files.join(", ")})`)
      .join("; ");

    expect(
      missing.size,
      `Service-invoked RPCs with no aisha/db/sql/functions/<name>.sql source ` +
        `(add the function or fix the call): ${report}`,
    ).toBe(0);
  });
});
