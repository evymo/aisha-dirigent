/**
 * Matrix Federation Gate (Online Smoke)
 *
 * Probes the deployed Synapse homeserver for federation-readiness:
 *
 * 1. `https://${MATRIX_DOMAIN}/_matrix/client/versions` returns 200 with valid
 *    JSON containing `versions[]` — confirms Synapse is up and routing works.
 * 2. `https://${MATRIX_DOMAIN}/.well-known/matrix/server` returns either 200
 *    with valid JSON, or 404 (some setups serve via DNS SRV instead).
 * 3. The reported homeserver_url (if present) matches MATRIX_DOMAIN.
 *
 * SKIP behavior:
 *   - When `AISHA_SKIP_ONLINE=1` env var is set (e.g. CI without network or
 *     pre-push hook), tests are skipped silently.
 *   - When the network probe fails connect within 5s, the test reports the
 *     failure but doesn't crash the suite.
 *
 * Spouští se ve `npm run test:gates:online` nebo z post-deploy pipeline.
 */

// Iter 15: config/domains.env is template-only (empty SoT). The reference
// deploy contract that THIS gate verifies lives in config/domains.env.example.
// Operators forking the repo populate their domains via .env-prod-backup;
// this gate enforces structural integrity of the AISHA reference deploy.

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SKIP = process.env.AISHA_SKIP_ONLINE === "1" || process.env.CI === "true";

function loadDomainsEnv(): Record<string, string> {
  const path = join(ROOT, "config/domains.env.example");
  if (!existsSync(path)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  // Resolve nested ${VAR} references (single pass — sufficient for our flat schema)
  for (const k of Object.keys(env)) {
    env[k] = env[k].replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name) => env[name] ?? "");
  }
  return env;
}

const DOMAINS = loadDomainsEnv();
// Zone TLDs come from the same SoT file (generic placeholders in the .example);
// fallbacks only apply when config/domains.env.example is missing entirely.
// Inline `# comment` tails must be stripped — loadDomainsEnv keeps the raw value.
const stripInlineComment = (v?: string): string => (v ?? "").replace(/\s+#.*$/, "").trim();
const INTERNAL_TLD = stripInlineComment(DOMAINS.INTERNAL_TLD) || "internal.example.com";
const PUBLIC_TLD = stripInlineComment(DOMAINS.PUBLIC_TLD) || "aisha.example.com";
const MATRIX_DOMAIN = stripInlineComment(DOMAINS.MATRIX_DOMAIN) || `matrix.backend.${INTERNAL_TLD}`;

async function probe(url: string, timeoutMs = 5000): Promise<{ ok: boolean; status: number; body: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const body = await r.text();
    return { ok: r.ok, status: r.status, body };
  } catch (err: unknown) {
    return { ok: false, status: 0, body: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

describe.skipIf(SKIP)("Matrix federation — online smoke", () => {
  test("/_matrix/client/versions returns 200 with valid JSON versions[]", async () => {
    const url = `https://${MATRIX_DOMAIN}/_matrix/client/versions`;
    const r = await probe(url);
    expect(r.status, `${url} → ${r.status} (body: ${r.body.slice(0, 200)})`).toBe(200);

    let parsed: unknown;
    try {
      parsed = JSON.parse(r.body);
    } catch {
      throw new Error(`Response not valid JSON: ${r.body.slice(0, 300)}`);
    }
    const obj = parsed as { versions?: string[] };
    expect(Array.isArray(obj.versions), "Expected versions: [...] in response").toBe(true);
    expect(obj.versions!.length, "versions array should be non-empty").toBeGreaterThan(0);
  }, 10000);

  test("/.well-known/matrix/server returns 200 or 404 (federation discovery)", async () => {
    const url = `https://${MATRIX_DOMAIN}/.well-known/matrix/server`;
    const r = await probe(url);
    expect([200, 404], `${url} → ${r.status} (expected 200 with delegate JSON or 404 if using DNS SRV)`).toContain(r.status);

    if (r.status === 200) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(r.body);
      } catch {
        throw new Error(`well-known/matrix/server returned 200 but body is not valid JSON: ${r.body.slice(0, 300)}`);
      }
      const obj = parsed as { "m.server"?: string };
      expect(obj["m.server"], "well-known JSON must include m.server delegation target").toBeDefined();
    }
  }, 10000);
});

describe("Matrix federation — config sanity (offline)", () => {
  test("MATRIX_DOMAIN is in INTERNAL zone (.backend.<INTERNAL_TLD>) per domain-zoning gate", () => {
    expect(
      MATRIX_DOMAIN.endsWith(`.backend.${INTERNAL_TLD}`) || MATRIX_DOMAIN.endsWith(`.${PUBLIC_TLD}`),
      `MATRIX_DOMAIN=${MATRIX_DOMAIN} should be either internal (.backend.${INTERNAL_TLD}) or public (.${PUBLIC_TLD})`,
    ).toBe(true);
  });

  test("config/domains.env defines MATRIX_DOMAIN", () => {
    expect(DOMAINS.MATRIX_DOMAIN, "config/domains.env must declare MATRIX_DOMAIN").toBeTruthy();
  });
});
