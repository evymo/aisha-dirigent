/**
 * No Hardcoded Domains in Compose ENV Blocks
 *
 * Enforces: every hostname in a compose `environment:` block goes through
 * the topology resolver via ${VAR:-default} substitution.
 *
 * Why this matters:
 *   The platform now supports 3 profiles (cloud-multi, cloud-single,
 *   local-dev) × 2 mesh modes. If a service hardcodes auth.backend.id3a.cz
 *   in its env block, switching to local-dev silently breaks — the
 *   container will try to reach a non-existent hostname.
 *
 * What's checked:
 *   - Lines inside `environment:` blocks
 *   - Lines outside Traefik labels (those MUST stay literal — Coolify v4
 *     escapes $ → $$ in label values, so ${VAR} would never match real
 *     traffic; memory: feedback_coolify_label_dollar_escape.md)
 *   - Lines outside comments (# headers / docs)
 *
 * Allowed exceptions:
 *   - cache.aisha.guru as a Docker image registry prefix (image: cache.aisha.guru/...)
 *   - admin@aisha.guru / similar email constants
 *   - host-gateway entries (extra_hosts)
 *   - Lines that are ALREADY env-driven (${VAR:-default}) — the default
 *     side IS allowed to be a literal hostname
 */
import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

const HOSTNAME_PATTERN =
  /[a-z0-9][a-z0-9-]*\.(?:backend|frontend|experimental|build)\.id3a\.cz|[a-z0-9][a-z0-9-]*\.aisha\.guru|[a-z0-9][a-z0-9-]*\.mesh\.aisha\.(?:network|internal)|[a-z0-9][a-z0-9-]*\.aisha\.network/g;

// Allowed-exception patterns. If a line matches any of these, hardcoded
// hostnames are tolerated.
const ALLOW_PATTERNS: RegExp[] = [
  /image:\s*cache\.aisha\.guru/,             // pull-through cache prefix
  // `FROM cache.aisha.guru/...` inside a `dockerfile_inline:` heredoc is the
  // same legitimate build-time image ref as `image: cache.aisha.guru/...` —
  // it just hits a different compose primitive. The matrix-config-init shape:
  //   dockerfile_inline: |
  //     FROM cache.aisha.guru/library/alpine:3.20
  //     COPY ...
  // Introduced by PR #191 (obs-stack init-container pattern, 2026-05-24); was
  // blocking every subsequent PR push because the gate flagged it as a hard-
  // coded runtime hostname when it's actually a build-time image reference
  // (Docker pulls it from the cache; topology resolver is irrelevant here).
  /^\s*FROM\s+cache\.aisha\.guru/,             // dockerfile_inline FROM clause
  /@aisha\.guru/,                             // email constants
  /:\s*host-gateway/,                          // extra_hosts entries
  /traefik\.http/,                             // Traefik labels (separate concern)
  /Host\(`/,                                   // Traefik Host rules
  /redirect-to-https/,                         // Traefik middleware
  /https:\/\/app\.aisha\.guru/,                // CSP frame-ancestors (legacy hardcode — separate clean-up wave)
  /frame-ancestors/,                           // Same
  /single-account-mode-domain=\$\{/,           // Already env-driven
];

interface Violation {
  file: string;
  line: number;
  text: string;
  hostname: string;
}

function getComposeFiles(): string[] {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT)
    .filter((n) => n.startsWith("docker-compose.coolify-") && n.endsWith(".yml"));
}

function scan(file: string): Violation[] {
  const violations: Violation[] = [];
  const content = readFileSync(join(ROOT, file), "utf-8");
  const lines = content.split("\n");

  let inLabels = false;
  let labelsIndent = -1;
  let inEnvironment = false;
  let envIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    // Track block context
    if (/^\s*labels:\s*$/.test(line)) {
      inLabels = true;
      labelsIndent = indent;
      inEnvironment = false;
      continue;
    }
    if (/^\s*environment:\s*$/.test(line)) {
      inEnvironment = true;
      envIndent = indent;
      inLabels = false;
      continue;
    }
    // Exit block when indent decreases or matches the block's own indent
    if (inLabels && trimmed && indent <= labelsIndent) inLabels = false;
    if (inEnvironment && trimmed && indent <= envIndent) inEnvironment = false;

    // Skip comments and pure-label lines
    if (/^\s*#/.test(line)) continue;
    if (inLabels) continue;

    // We're interested in everything OUTSIDE labels (env blocks + entrypoint
    // shell scripts + extra_hosts + ports + image refs all included).
    if (ALLOW_PATTERNS.some((p) => p.test(line))) continue;

    // Strip already-resolved ${VAR:-default} sequences before checking for
    // raw hostnames. The default side is allowed (it IS the cloud-multi
    // production default, with a fallback for static-mode operation).
    const stripped = line.replace(/\$\{[^}]+\}/g, "");

    const matches = stripped.match(HOSTNAME_PATTERN);
    if (!matches) continue;

    for (const hn of matches) {
      // Sometimes the pattern matches inside ${VAR:-host} — we already
      // stripped those. So if hostname remains, it's a true hardcode.
      violations.push({
        file,
        line: i + 1,
        text: line.trim(),
        hostname: hn,
      });
    }
  }
  return violations;
}

describe("No hardcoded domains in compose ENV blocks", () => {
  test("compose files don't reference *.backend.id3a.cz / *.aisha.guru / *.mesh.aisha.internal outside labels (Traefik labels are exempt)", () => {
    const all: Violation[] = [];
    for (const f of getComposeFiles()) {
      all.push(...scan(f));
    }

    // BASELINE — legacy hardcodes outside ENV blocks that are still allowed.
    // Most are in entrypoint shell scripts (diagnostic ssl s_client probes,
    // ping tests) and CSP headers where the literal hostname is the actual
    // diagnostic target — wrapping in ${VAR:-default} would change semantics.
    //
    // Subsequent waves can shrink this set. New code violating elsewhere
    // fails the gate.
    const KNOWN_LEGACY = new Set<string>([
      "docker-compose.coolify-langfuse.yml",  // CSP frame-ancestors
      "docker-compose.coolify-pki.yml",       // PKI cert SANs in entrypoint
      "docker-compose.coolify-prebuilt.yml",  // mesh-router diagnostic ssl probes + ping tests
    ]);

    const newViolations = all.filter((v) => !KNOWN_LEGACY.has(v.file));

    if (newViolations.length > 0) {
      const msg = newViolations
        .map((v) => `${v.file}:${v.line} hardcoded ${v.hostname} — wrap in \${VAR:-${v.hostname}}`)
        .join("\n");
      expect(
        newViolations,
        `Hardcoded domains found in compose env/entrypoint blocks. ` +
          `Wrap each in \${VAR:-default} so the topology resolver can substitute.\n${msg}`,
      ).toEqual([]);
    }
  });
});
