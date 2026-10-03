/**
 * Gate (remediation FE-04-nginx-csp): the static web image's nginx config must
 * (a) set a Content-Security-Policy header, and (b) because nginx's add_header
 * directive does NOT inherit from an outer block into any location that declares
 * its OWN add_header, repeat the full set of security headers inside EVERY such
 * location block.
 *
 * Why this exists: docker/nginx.conf declares the security headers
 *   X-Frame-Options / X-Content-Type-Options / Referrer-Policy / Permissions-Policy
 * once at server{} scope. But every location{} block in that file also declares
 * its own add_header (Cache-Control). Per nginx semantics, the moment a location
 * declares any add_header the inherited server-level add_headers are DROPPED for
 * responses served from that location. Result: assets, index.html and the SPA
 * fallback are all served with ZERO security headers. And there is no
 * Content-Security-Policy anywhere at all.
 *
 * Contract enforced here:
 *   1. A Content-Security-Policy add_header appears somewhere in the config.
 *   2. Every location{} block that declares at least one add_header also
 *      declares ALL of the required security headers (incl. CSP) — otherwise
 *      those headers silently vanish for that location.
 *
 * KNOWN-RED at authoring time (branch feat/remediation):
 *   - No Content-Security-Policy directive anywhere -> requirement (1) fails.
 *   - 5 location blocks declare add_header (Cache-Control) but none of the
 *     security headers -> requirement (2) fails for every one of them:
 *       location ~ \.mjs$ , location ~ \.wasm$ , location /assets/ ,
 *       location = /index.html , location /
 *
 * After the fix (add CSP + repeat the header set in each location, e.g. via an
 * `include` snippet) this gate goes green. Do NOT allowlist the offenders —
 * repeat the headers. The allowlist is reserved ONLY for a location that
 * legitimately serves no body carrying security-relevant content (none today).
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const NGINX_CONF = "docker/nginx.conf";

/**
 * Security headers that must ride on every response. add_header names are
 * matched case-insensitively (nginx header names are case-insensitive).
 */
const REQUIRED_HEADERS = [
  "Content-Security-Policy",
  "X-Frame-Options",
  "X-Content-Type-Options",
  "Referrer-Policy",
  "Permissions-Policy",
];

/**
 * location blocks intentionally exempt (must be justified in-comment). Keyed by
 * the raw location matcher text (e.g. "= /healthz"). Empty today.
 */
const ALLOWLIST = new Set<string>([]);

interface LocationBlock {
  matcher: string;
  body: string;
}

/** Strip `#` line comments so a commented-out directive can't satisfy the gate. */
function stripComments(src: string): string {
  return src
    .split("\n")
    .map((l) => l.replace(/#.*$/, ""))
    .join("\n");
}

/**
 * Extract every `location <matcher> { ... }` block with balanced-brace matching
 * so nested braces (e.g. `types { }`) don't terminate the block early.
 */
function extractLocationBlocks(src: string): LocationBlock[] {
  const blocks: LocationBlock[] = [];
  const re = /location\s+([^{]+?)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const matcher = m[1].trim();
    // Walk from the opening brace, tracking depth.
    let depth = 1;
    let i = re.lastIndex;
    const start = i;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    const body = src.slice(start, i - 1);
    blocks.push({ matcher, body });
  }
  return blocks;
}

/** Does this block declare an add_header for the given header name? */
function declaresHeader(body: string, headerName: string): boolean {
  const re = new RegExp(
    `add_header\\s+${headerName.replace(/[-]/g, "[-]")}\\b`,
    "i",
  );
  return re.test(body);
}

function declaresAnyAddHeader(body: string): boolean {
  return /add_header\s+/i.test(body);
}

describe("nginx web security-headers contract (docker/nginx.conf)", () => {
  const raw = readFileSync(join(ROOT, NGINX_CONF), "utf-8");
  const src = stripComments(raw);

  test("a Content-Security-Policy header is declared somewhere", () => {
    expect(
      declaresHeader(src, "Content-Security-Policy"),
      "docker/nginx.conf declares no Content-Security-Policy add_header anywhere",
    ).toBe(true);
  });

  test("every location that sets add_header repeats ALL security headers", () => {
    const blocks = extractLocationBlocks(src);
    expect(blocks.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const { matcher, body } of blocks) {
      if (ALLOWLIST.has(matcher)) continue;
      // Only location blocks that declare their own add_header suppress the
      // inherited server-level headers — those are the ones at risk.
      if (!declaresAnyAddHeader(body)) continue;
      const missing = REQUIRED_HEADERS.filter((h) => !declaresHeader(body, h));
      if (missing.length > 0) {
        offenders.push(`location ${matcher} (missing: ${missing.join(", ")})`);
      }
    }

    expect(
      offenders,
      `location blocks declare add_header but drop inherited security headers:\n  ${offenders.join(
        "\n  ",
      )}`,
    ).toEqual([]);
  });
});
