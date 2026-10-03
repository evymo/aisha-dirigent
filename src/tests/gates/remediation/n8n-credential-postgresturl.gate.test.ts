/**
 * REMEDIATION GATE — N8N-01-credential-key
 *
 * CONTRACT: No AISHA n8n custom node may read the credential key `supabaseUrl`
 * from the `aishaPostgrestApi` credential. The credential class
 * (packages/n8n-nodes-aisha/credentials/AishaPostgrestApi.credentials.ts)
 * defines the URL property as `postgrestUrl` — the legacy `supabaseUrl` name
 * was retired when the credential type was renamed from `aishaSupabaseApi` to
 * `aishaPostgrestApi` (PR #82, May 2026). Any node still reading `supabaseUrl`
 * resolves to `undefined` at runtime and silently builds a broken request URL.
 *
 * This gate walks every `*.node.ts` under packages/n8n-nodes-aisha/nodes and
 * flags each file that reads the stale key via either shape:
 *   1. requireCredString(<creds>, 'supabaseUrl', ...)
 *   2. <credsVar>.supabaseUrl   (direct property read off getCredentials(...))
 *
 * KNOWN-RED at authoring time (HEAD 569c5ffd): AishaRpc, AishaAudit,
 * AishaTrigger, AishaStoryManager, AishaGitHubApp, AishaNodeFactory,
 * AishaAdminBridge — plus AishaModelRouter (overlooked sibling this scan
 * surfaces). After remediation every node must read `postgrestUrl`.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const NODES_DIR = path.resolve(
  __dirname,
  "../../../../packages/n8n-nodes-aisha/nodes",
);

/**
 * Intentional exceptions. Empty — the contract admits no legitimate reader of
 * the retired `supabaseUrl` key. Documented here so a future intentional
 * exception is an explicit, reviewed edit rather than a silent regex tweak.
 */
const ALLOWLIST: readonly string[] = [];

function walkNodeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkNodeFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".node.ts")) {
      out.push(full);
    }
  }
  return out;
}

// requireCredString(<anything up to a comma>, 'supabaseUrl' ...)
const REQUIRE_CRED_STALE = /requireCredString\([^,]+,\s*['"]supabaseUrl['"]/;
// <identifier>.supabaseUrl — a direct property read (NOT ${supabaseUrl} template refs)
const PROP_READ_STALE = /\b\w+\.supabaseUrl\b/;

describe("N8N-01 — aishaPostgrestApi credential key contract", () => {
  it("no node reads the retired `supabaseUrl` key (credential defines `postgrestUrl`)", () => {
    expect(fs.existsSync(NODES_DIR)).toBe(true);

    const offenders: { node: string; matches: string[] }[] = [];

    for (const file of walkNodeFiles(NODES_DIR)) {
      const rel = path.relative(NODES_DIR, file);
      if (ALLOWLIST.includes(rel)) continue;

      const src = fs.readFileSync(file, "utf8");
      const hits: string[] = [];
      src.split("\n").forEach((line, i) => {
        if (REQUIRE_CRED_STALE.test(line) || PROP_READ_STALE.test(line)) {
          hits.push(`  L${i + 1}: ${line.trim()}`);
        }
      });
      if (hits.length > 0) {
        offenders.push({ node: rel, matches: hits });
      }
    }

    const report = offenders
      .map((o) => `${o.node}\n${o.matches.join("\n")}`)
      .join("\n\n");

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `Nodes reading retired credential key 'supabaseUrl' ` +
            `(must read 'postgrestUrl' per AishaPostgrestApi.credentials.ts):\n\n${report}`,
    ).toEqual([]);
  });
});
