/**
 * pki-renewer reaches Keycloak via PUBLIC DNS (not a host-gateway pin)
 *
 * WHY (incident 2026-07-17, the final cold-start blocker):
 *   aisha-pki-renewer is the SINGLE owner of the *.mesh cert lifecycle. It gets a
 *   client_credentials token from Keycloak, then asks pki-bridge to issue each mesh
 *   cert (core.mesh, netbird.mesh). The renewer service pinned the KC host to
 *   `host-gateway` via extra_hosts, assuming aisha-pki is co-located with the
 *   backend Traefik. On a split fleet that is FALSE: aisha-pki ran on giah, whose
 *   host-gateway:443 serves a self-signed DEFAULT cert (not KC's LE cert). curl's
 *   TLS verify rejected it (DEPTH_ZERO_SELF_SIGNED_CERT) → "token acquisition
 *   failed" every cycle → NO mesh cert ever issued → netbird-internal-tls fell back
 *   to Caddy `tls internal` → netbird agents (which trust only aisha-ca-bundle)
 *   failed the mesh gRPC handshake → core/integration/messaging/observability-stack
 *   sidecars never enrolled → those 4 stacks stayed unhealthy.
 *
 *   pki-bridge already learned this (its in-file NOTE): the correct path is PUBLIC
 *   DNS → pfSense → Backend Traefik → KC, using the publicly-trusted LE cert. KC's
 *   fixed frontend issuer keeps the token `iss` correct regardless of host. Verified
 *   in prod: the renewer container reached the public host with HTTP 200 + a valid
 *   token, while host-gateway:443 was self-signed.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PKI_COMPOSE = join(ROOT, "docker-compose.coolify-pki.yml");

describe("pki-renewer — KC via public DNS, no host-gateway pin", () => {
  const compose = readFileSync(PKI_COMPOSE, "utf-8");

  // Bound the pki-renewer service block (from `pki-renewer:` to the next top-level
  // service key at the same indentation, or end of file).
  const renewerBlock = (() => {
    const start = compose.indexOf("\n  pki-renewer:");
    if (start < 0) return "";
    const after = compose.slice(start + 1);
    const next = after.search(/\n {2}[a-z0-9_-]+:\n/);
    return next > -1 ? after.slice(0, next) : after;
  })();

  test("the pki-renewer service block exists", () => {
    expect(renewerBlock, "could not locate the pki-renewer service in the pki compose").not.toBe("");
  });

  test("pki-renewer KEYCLOAK_URL uses the PUBLIC host (LE cert via public DNS), not the DIRECT host", () => {
    expect(
      renewerBlock,
      "pki-renewer must reach KC via ${KEYCLOAK_DOMAIN_PUBLIC} (public DNS → LE cert), mirroring pki-bridge.",
    ).toMatch(/KEYCLOAK_URL:\s*https:\/\/\$\{KEYCLOAK_DOMAIN_PUBLIC\}/);
    expect(
      renewerBlock,
      "pki-renewer must NOT reach KC via ${KEYCLOAK_DOMAIN_DIRECT} — the direct host is only LE-valid when co-located with the backend Traefik; on a split fleet host-gateway:443 is self-signed.",
    ).not.toMatch(/KEYCLOAK_URL:\s*https:\/\/\$\{KEYCLOAK_DOMAIN_DIRECT\}/);
  });

  test("pki-renewer does NOT pin any KC host to host-gateway (self-signed cert path)", () => {
    // The renewer must not carry an extra_hosts entry mapping a KEYCLOAK_DOMAIN_*
    // host to host-gateway — that is exactly the self-signed-cert trap.
    expect(
      renewerBlock,
      "pki-renewer must not pin KEYCLOAK_DOMAIN_* to host-gateway (host-gateway:443 serves a self-signed cert off-node, breaking TLS verify → no mesh cert issued).",
    ).not.toMatch(/KEYCLOAK_DOMAIN_(DIRECT|PUBLIC)[^\n]*:host-gateway/);
  });
});
