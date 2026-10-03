/**
 * Gate (remediation PLG-01-broker-kv-rpc): every `plugin_kv_*` RPC that
 * svc-plugin-system calls MUST exist as a SQL function file under
 * aisha/db/sql/functions/<name>.sql.
 *
 * Why this exists: the plugin sandbox broker (routes/broker.ts) and the sandbox
 * host context (sandbox.ts) expose a per-plugin key/value store to untrusted
 * plugin code. They invoke it via `rpcService('plugin_kv_get' | 'plugin_kv_set'
 * | 'plugin_kv_delete', …)`. PostgREST resolves an RPC name to a SQL function;
 * if no such function exists the call fails at runtime (PGRST202) — and because
 * missing-RPC failures are commonly swallowed, the KV store silently no-ops:
 * `get` returns nothing, `set`/`delete` appear to succeed but persist nothing.
 * That is a correctness AND security defect (plugins believe state is stored).
 *
 * The contract: for every DISTINCT `plugin_kv_*` RPC name referenced by
 * svc-plugin-system source, a file aisha/db/sql/functions/<name>.sql must exist.
 *
 * KNOWN-RED at authoring time (branch feat/remediation): broker.ts + sandbox.ts
 * call plugin_kv_get / plugin_kv_set / plugin_kv_delete, but the ONLY KV SQL
 * function on disk is sandbox_kv_op.sql. None of the three plugin_kv_* names
 * has a matching SQL file, so all three are missing.
 *
 * After the fix (add aisha/db/sql/functions/plugin_kv_get.sql, plugin_kv_set.sql,
 * plugin_kv_delete.sql — or rewire the call sites onto a real function such as
 * sandbox_kv_op) this gate goes green. Do NOT weaken the gate — create the SQL
 * functions or fix the call sites at the source of truth.
 *
 * Generalization: this scans the ENTIRE svc-plugin-system/src tree (not just the
 * two named files) so any additional plugin_kv_* call site with no backing SQL
 * function is also caught.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SRC_DIR = "services/svc-plugin-system/src";
const FUNCTIONS_DIR = "aisha/db/sql/functions";

/** Strip `//` and block comments so a commented-out mention doesn't count. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

/** Recursively list *.ts source files under a directory (skips *.d.ts). */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...tsFiles(rel));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Collect every distinct `plugin_kv_*` RPC name referenced via
 * rpcService('plugin_kv_…') / rpcService("plugin_kv_…") across the src tree,
 * remembering which file(s) referenced it.
 */
function collectPluginKvRpcs(): Map<string, Set<string>> {
  const calls = new Map<string, Set<string>>();
  const re = /rpcService\s*\(\s*['"](plugin_kv_[a-z0-9_]+)['"]/g;
  for (const file of tsFiles(SRC_DIR)) {
    const src = stripComments(readFileSync(join(ROOT, file), "utf-8"));
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const name = m[1];
      if (!calls.has(name)) calls.set(name, new Set());
      calls.get(name)!.add(file);
    }
  }
  return calls;
}

function sqlFunctionExists(name: string): boolean {
  return existsSync(join(ROOT, FUNCTIONS_DIR, `${name}.sql`));
}

describe("plugin_kv_* RPC ⇄ SQL function contract", () => {
  test("every plugin_kv_* RPC called by svc-plugin-system has a matching SQL function file", () => {
    const calls = collectPluginKvRpcs();

    // Guard: the scan must actually find the known call sites, otherwise a
    // refactor/rename would make this gate silently vacuous.
    expect(
      [...calls.keys()].sort(),
      "expected plugin_kv_* rpcService call sites to be present in svc-plugin-system/src",
    ).toEqual(
      expect.arrayContaining([
        "plugin_kv_delete",
        "plugin_kv_get",
        "plugin_kv_set",
      ]),
    );

    const missing = [...calls.entries()]
      .filter(([name]) => !sqlFunctionExists(name))
      .map(([name, files]) => `${name} (called in ${[...files].sort().join(", ")})`)
      .sort();

    expect(
      missing,
      `plugin_kv_* RPCs with no aisha/db/sql/functions/<name>.sql file:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });
});
