/**
 * Gate: pki-bridge-public-issuer
 *
 * Guards the regression that crash-looped netbird (and broke every PKI cert
 * issuance) on the backend: pki-bridge validates the inbound JWT's `iss` claim
 * against `expectedIssuer = ${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}` (see
 * services/svc-pki-bridge/src/config.ts). Keycloak has a FIXED public frontend
 * issuer — even a ROPC token minted via the INTERNAL hostname comes back with
 *   iss = https://auth.aisha.guru/realms/aisha   (= KEYCLOAK_DOMAIN_PUBLIC)
 *
 * docker-compose.coolify-pki.yml had pki-bridge's KEYCLOAK_URL wired to the
 * INTERNAL domain (`https://${KEYCLOAK_DOMAIN}` = auth.backend.id3a.cz). The
 * expected `iss` therefore never matched the token's `iss`, so pki-bridge
 * rejected every cert request with HTTP 401 "Invalid, expired, or
 * wrong-audience token". pki-init then fell back to self-signed, internal-tls
 * exited 127, and netbird-management crash-looped.
 *
 * The rule:
 *   pki-bridge's KEYCLOAK_URL (which drives the expected `iss`) MUST reference
 *   KEYCLOAK_DOMAIN_PUBLIC — mirroring oauth2-proxy's OAUTH2_PROXY_OIDC_ISSUER_URL,
 *   which already uses the public domain. KEYCLOAK_INTERNAL_URL (JWKS fetch only,
 *   hostname need not match `iss`) stays free to use the internal domain.
 *
 * Why a gate: the public/internal split is subtle and the two URLs sit on
 * adjacent lines. A future edit that "normalises" both to KEYCLOAK_DOMAIN would
 * silently re-introduce the exact 401 / crash-loop, only discoverable at
 * cold-start. This catches it at PR time.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();
const PKI_COMPOSE = path.join(ROOT, "docker-compose.coolify-pki.yml");

/**
 * Extract the `environment:` block of a named service from a compose file as
 * raw text. Returns the lines between `<service>:` and the next top-level
 * service (2-space indent) — sufficient for a value-presence assertion without
 * pulling in a YAML parser.
 */
function extractServiceEnvBlock(compose: string, service: string): string {
  const lines = compose.split("\n");
  const startIdx = lines.findIndex((l) => new RegExp(`^ {2}${service}:\\s*$`).test(l));
  if (startIdx === -1) return "";
  // Find the next sibling service (2-space indent, ends with ':') after start.
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join("\n");
}

/** Pull `KEY: value` (trimmed) from an environment block. */
function envValue(block: string, key: string): string | undefined {
  const m = block.match(new RegExp(`^\\s+${key}:\\s*(.+?)\\s*$`, "m"));
  return m ? m[1].trim() : undefined;
}

describe("gate: pki-bridge public-issuer wiring", () => {
  const compose = fs.readFileSync(PKI_COMPOSE, "utf8");
  const bridgeEnv = extractServiceEnvBlock(compose, "pki-bridge");

  it("pki-bridge service env block is present", () => {
    expect(bridgeEnv, "pki-bridge service must exist in docker-compose.coolify-pki.yml").toContain(
      "KEYCLOAK_URL",
    );
  });

  it("pki-bridge KEYCLOAK_URL drives expected iss → must use KEYCLOAK_DOMAIN_PUBLIC", () => {
    const keycloakUrl = envValue(bridgeEnv, "KEYCLOAK_URL");
    expect(keycloakUrl, "pki-bridge KEYCLOAK_URL must be set").toBeTruthy();
    expect(
      keycloakUrl,
      "pki-bridge KEYCLOAK_URL drives the expected `iss` claim and MUST reference " +
        "KEYCLOAK_DOMAIN_PUBLIC (the issuer Keycloak stamps into tokens). Using the " +
        "internal KEYCLOAK_DOMAIN here causes a 401 issuer mismatch on every cert request.",
    ).toContain("KEYCLOAK_DOMAIN_PUBLIC");
    expect(
      keycloakUrl,
      "pki-bridge KEYCLOAK_URL must NOT use the bare internal ${KEYCLOAK_DOMAIN}",
    ).not.toMatch(/\$\{KEYCLOAK_DOMAIN\}/);
  });

  it("pki-bridge KEYCLOAK_INTERNAL_URL (JWKS path) is derived, and never mesh or public", () => {
    const internalUrl = envValue(bridgeEnv, "KEYCLOAK_INTERNAL_URL");
    expect(internalUrl, "pki-bridge KEYCLOAK_INTERNAL_URL must be set").toBeTruthy();

    // This hop validates the token that mints the MESH certificate, so it is a
    // mesh-bootstrap dependency: it must resolve without the mesh existing yet.
    // Two ways to get that wrong, both asserted:
    expect(
      internalUrl,
      "must not use the public domain — that leaves the host and hairpins back in (the original 401)",
    ).not.toContain("KEYCLOAK_DOMAIN_PUBLIC");
    expect(
      internalUrl,
      "must not use ${KEYCLOAK_DOMAIN} — the generic loop mesh-ifies it, putting the JWKS fetch " +
        "on the overlay this very fetch is bootstrapping",
    ).not.toMatch(/\$\{KEYCLOAK_DOMAIN[}:]/);

    // Positively: take the value the resolver derives, rather than spelling a
    // host here. derive-domains picks the shared-network alias when Keycloak and
    // PKI land on the same node and the direct host when they do not — a compose
    // literal cannot express that. The previous assertion here only required the
    // string "KEYCLOAK_DOMAIN" to appear, which is a variable NAME rather than an
    // invariant: `${KEYCLOAK_DOMAIN}` (mesh) satisfied it, so the rule invited
    // back the very value e021418c removed.
    expect(
      internalUrl,
      "KEYCLOAK_INTERNAL_URL must come from the resolver (derive-domains), not an inline hostname",
    ).toMatch(/^\$\{KEYCLOAK_INTERNAL_URL[:?}]/);
  });

  it("the resolver actually emits KEYCLOAK_INTERNAL_URL", () => {
    // Without this, the assertion above could pass while the variable is never
    // produced — and the compose default would quietly carry the deployment.
    const out = execFileSync(
      "node",
      [path.join(ROOT, "scripts/lib/derive-domains.mjs"), "--profile=cloud-multi", "--shell"],
      {
        cwd: ROOT,
        encoding: "utf-8",
        env: {
          ...process.env,
          PUBLIC_TLD: "public.example",
          INTERNAL_TLD: "internal.example",
          MESH_TLD: "mesh.example",
        },
      },
    );
    const line = out.split("\n").find((l) => l.startsWith("KEYCLOAK_INTERNAL_URL="));
    expect(line, "derive-domains must emit KEYCLOAK_INTERNAL_URL").toBeTruthy();
    expect(line, "same-node fleets reach Keycloak on the shared-network alias").toContain(
      "http://aisha-keycloak:80",
    );
  });

  it("pki-bridge expected iss mirrors oauth2-proxy OIDC issuer (both public)", () => {
    const oauth2Env = extractServiceEnvBlock(compose, "oauth2-proxy");
    // oauth2-proxy may live in this compose; if present, its issuer must also be public.
    if (oauth2Env) {
      const issuer = envValue(oauth2Env, "OAUTH2_PROXY_OIDC_ISSUER_URL");
      if (issuer) {
        expect(
          issuer,
          "oauth2-proxy OIDC issuer must use KEYCLOAK_DOMAIN_PUBLIC (consistency anchor)",
        ).toContain("KEYCLOAK_DOMAIN_PUBLIC");
      }
    }
  });
});
