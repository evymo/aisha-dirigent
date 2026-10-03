/**
 * PKI SAN Contract Gate
 *
 * Enforces that every SAN (Subject Alternative Name) that a cert-issuing
 * client requests from `pki-bridge /v1/issue` is covered by the bridge's
 * server-side allow-list (`PKI_ALLOWED_SAN_PATTERNS`).
 *
 * Why this gate exists (2026-05-11 cold-start failure):
 *   Commit `3a45b917` ("refactor(mesh): pure intra-cluster Signal via
 *   Docker DNS") added bare Docker DNS service names — `netbird-internal-tls`,
 *   `netbird-signal`, `netbird-management` — to `NETBIRD_MESH_EXTRA_SANS`
 *   in `infra/pki/issue-netbird-mesh-cert.sh`, so that cross-stack TLS
 *   could validate SNI against those hostnames. But the matching
 *   server-side allow-list in `docker-compose.coolify-pki.yml`
 *   (`PKI_ALLOWED_SAN_PATTERNS`) was NEVER updated, so every cold-start
 *   netbird `pki-init` got an HTTP 403:
 *     "Forbidden: requested SAN(s) not in allowed patterns"
 *   → caddy-internal-tls fell back to self-signed → mesh broken.
 *
 *   The drift survived undetected because client and server live in
 *   different compose files and nothing cross-references them.
 *
 * What's checked:
 *   1. Parse the default value of `NETBIRD_MESH_HOST` + `NETBIRD_MESH_EXTRA_SANS`
 *      from `docker-compose.coolify-netbird.yml`'s `pki-init` service env block.
 *   2. Parse the default value of `PKI_ALLOWED_SAN_PATTERNS` from
 *      `docker-compose.coolify-pki.yml`'s `pki-bridge` service env block.
 *   3. For every SAN the client requests, assert that it matches at
 *      least one pattern in the server's allow-list, using the SAME
 *      matching algorithm implemented in
 *      `services/svc-pki-bridge/src/routes/issue.ts::matchesSanPolicy`.
 *
 *   The match function is inlined here (rather than imported) to keep
 *   the gate independent of service build state.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const NETBIRD_COMPOSE = join(ROOT, "docker-compose.coolify-netbird.yml");
const PKI_COMPOSE = join(ROOT, "docker-compose.coolify-pki.yml");
const ISSUE_SCRIPT = join(ROOT, "infra/pki/issue-netbird-mesh-cert.sh");

// ── Default-value extraction ─────────────────────────────────────────────────
// Two source styles to handle:
//
//   compose (YAML)   `KEY: ${KEY:-default}` or `KEY: "literal"`
//   shell script     `KEY="${KEY:-default}"` (POSIX sh parameter expansion)
//
// We extract the BAKED default — that's the contract authored in this
// repo. Runtime Coolify env can override, but the gate enforces what a
// fresh install ships with.

function extractComposeEnvDefault(compose: string, key: string): string | null {
  const interpolated = new RegExp(
    `^\\s+${key}:\\s*"?\\$\\{${key}:-([^}"\\n]*)\\}"?\\s*$`,
    "m",
  );
  const literalQuoted = new RegExp(`^\\s+${key}:\\s*"([^"\\n]*)"\\s*$`, "m");
  const literalBare = new RegExp(`^\\s+${key}:\\s*([^\\n#]+?)\\s*$`, "m");

  const i = compose.match(interpolated);
  if (i?.[1] != null) return i[1];
  const lq = compose.match(literalQuoted);
  if (lq?.[1] != null) return lq[1];
  const lb = compose.match(literalBare);
  if (lb?.[1] != null) return lb[1].replace(/^["']|["']$/g, "");

  return null;
}

function extractShellEnvDefault(script: string, key: string): string | null {
  // Matches: KEY="${KEY:-default}"
  const interpolated = new RegExp(
    `^${key}="\\$\\{${key}:-([^}]*)\\}"\\s*$`,
    "m",
  );
  const m = script.match(interpolated);
  return m?.[1] ?? null;
}

// ── matchesSanPolicy — mirror of services/svc-pki-bridge/src/routes/issue.ts ─
// Keep this in sync with the server implementation. If the algorithm
// there changes (e.g. multi-level wildcard support), update this too.
function matchesSanPolicy(hostname: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1); // ".mesh.aisha.internal"
      return (
        hostname.endsWith(suffix) &&
        !hostname.slice(0, -suffix.length).includes(".")
      );
    }
    return hostname === pattern;
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseCsvList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

describe("PKI SAN Contract — client requests covered by server allow-list", () => {
  test("netbird-mesh-cert SANs all match pki-bridge allow-list patterns", () => {
    const netbirdCompose = readFileSync(NETBIRD_COMPOSE, "utf-8");
    const pkiCompose = readFileSync(PKI_COMPOSE, "utf-8");
    const issueScript = readFileSync(ISSUE_SCRIPT, "utf-8");

    // ── 1. What does the client request? ──
    // NETBIRD_MESH_HOST comes from compose (passed in via env block).
    // NETBIRD_MESH_EXTRA_SANS lives in the shell script default — netbird
    // compose doesn't override it, so the shell script is the source of truth.
    const meshHost = extractComposeEnvDefault(
      netbirdCompose,
      "NETBIRD_MESH_HOST",
    );
    expect(
      meshHost,
      "docker-compose.coolify-netbird.yml must declare NETBIRD_MESH_HOST in pki-init env (with `${VAR:-default}` form).",
    ).not.toBeNull();

    const extraSansRaw = extractShellEnvDefault(
      issueScript,
      "NETBIRD_MESH_EXTRA_SANS",
    );
    expect(
      extraSansRaw,
      "infra/pki/issue-netbird-mesh-cert.sh must declare NETBIRD_MESH_EXTRA_SANS default with `KEY=\"${KEY:-default}\"` syntax. Allowed default may be empty (no extra SANs).",
    ).not.toBeNull();

    // Filter out bare `${VAR}` references — per iter 10 template-only cleanup,
    // NETBIRD_MESH_HOST is operator-set via Coolify env (no in-compose default).
    // We can't statically verify a value we don't have at gate-time; the
    // contract guarantee is structural (the env var is referenced and the
    // server allow-list covers expected patterns). Operator must ensure their
    // chosen hostname matches one of PKI_ALLOWED_SAN_PATTERNS.
    const isEnvOnlyRef = (s: string) => /^\$\{[A-Z_][A-Z0-9_]*\}$/.test(s);
    const requestedSans = [meshHost!, ...parseCsvList(extraSansRaw!)].filter(
      (s) => !isEnvOnlyRef(s),
    );

    // ── 2. What does the server allow? ──
    const allowedRaw = extractComposeEnvDefault(
      pkiCompose,
      "PKI_ALLOWED_SAN_PATTERNS",
    );
    expect(
      allowedRaw,
      "docker-compose.coolify-pki.yml must declare PKI_ALLOWED_SAN_PATTERNS in pki-bridge env.",
    ).not.toBeNull();

    const allowedPatterns = parseCsvList(allowedRaw!);
    expect(
      allowedPatterns.length,
      "PKI_ALLOWED_SAN_PATTERNS must contain at least one pattern — empty allow-list denies ALL SANs.",
    ).toBeGreaterThan(0);

    // ── 3. Every requested SAN must match at least one allowed pattern ──
    const forbidden = requestedSans.filter(
      (san) => !matchesSanPolicy(san, allowedPatterns),
    );

    expect(
      forbidden,
      [
        "Client/server SAN contract drift detected.",
        "",
        "Client (NETBIRD_MESH_HOST from coolify-netbird.yml + NETBIRD_MESH_EXTRA_SANS default from issue-netbird-mesh-cert.sh):",
        ...requestedSans.map((s) => `  requests: ${s}`),
        "",
        "Server (docker-compose.coolify-pki.yml::PKI_ALLOWED_SAN_PATTERNS):",
        ...allowedPatterns.map((p) => `  allows:   ${p}`),
        "",
        "FORBIDDEN by server policy:",
        ...forbidden.map((s) => `  - ${s}`),
        "",
        "Fix: either",
        "  (a) Drop unused entries from NETBIRD_MESH_EXTRA_SANS default in",
        "      infra/pki/issue-netbird-mesh-cert.sh (around line 49), or",
        "  (b) Add covering patterns to PKI_ALLOWED_SAN_PATTERNS in",
        "      docker-compose.coolify-pki.yml's pki-bridge env block.",
        "",
        "Symptom this gate prevents:",
        "  netbird pki-init logs `pki-bridge /v1/issue failed: curl: (22) ... 403`,",
        "  caddy-internal-tls falls back to self-signed, mesh agents fail TLS verify.",
      ].join("\n"),
    ).toEqual([]);
  });

  test("matchesSanPolicy mirror — wildcard semantics match server implementation", () => {
    // Self-test of the mirrored algorithm so it can't silently drift from
    // services/svc-pki-bridge/src/routes/issue.ts::matchesSanPolicy.
    const patterns = ["*.mesh.aisha.internal", "exact-name"];

    // Single-level wildcard: prefix must NOT contain a dot
    expect(matchesSanPolicy("a.mesh.aisha.internal", patterns)).toBe(true);
    expect(matchesSanPolicy("nested.a.mesh.aisha.internal", patterns)).toBe(false);
    expect(matchesSanPolicy("mesh.aisha.internal", patterns)).toBe(false);

    // Exact-match (no wildcard)
    expect(matchesSanPolicy("exact-name", patterns)).toBe(true);
    expect(matchesSanPolicy("exact-name.foo", patterns)).toBe(false);
    expect(matchesSanPolicy("foo.exact-name", patterns)).toBe(false);

    // Empty patterns → reject everything
    expect(matchesSanPolicy("anything", [])).toBe(false);
  });
});
