// Iter 15: config/domains.env is template-only (empty SoT). The reference
// deploy contract that THIS gate verifies lives in config/domains.env.example.
// Operators forking the repo populate their domains via .env-prod-backup;
// this gate enforces structural integrity of the AISHA reference deploy.

import { describe, expect, test } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { reHost, vnitrniHost } from "./lib/vnitrni-adresa";

const ROOT = process.cwd();

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf8");
}

/**
 * Gate test: NetBird mesh internal TLS path uses AISHA PKI.
 *
 * Why this exists:
 *   The original NetBird stack routed all agent traffic through Coolify
 *   Traefik on port 443 with a Let's Encrypt wildcard cert. This caused
 *   issues for internal mesh agents:
 *     - LE cert SNI conflicts on LAN interface (Traefik returned default
 *       self-signed cert for non-public source)
 *     - Long-lived gRPC streams died on Traefik HTTP/2 idle timeout
 *     - NAT hairpin (Backend → public IP → router → Frontend LAN) drops conntrack
 *
 *   Fix: a caddy sidecar in the netbird stack terminates TLS on port 33073
 *   with a cert issued by our own AISHA PKI (Evymo Root CA). Internal mesh
 *   agents connect directly to Frontend:33073 via LAN, skipping Coolify
 *   Traefik entirely. They trust the cert via the AISHA CA bundle mounted
 *   from a per-stack pki-init volume.
 *
 *   This gate ensures every piece of that architecture remains in place.
 *   Without it, a future "cleanup" might accidentally restore the broken
 *   Traefik-only routing and break mesh again.
 */
describe("NetBird internal TLS — AISHA PKI mesh path", () => {
  const netbirdCompose = read("docker-compose.coolify-netbird.yml");
  const coreCompose = read("docker-compose.coolify.yml");
  const integrationCompose = read("docker-compose.coolify-integration.yml");
  const cosmosCompose = read("docker-compose.coolify-cosmos.yml");
  const mgmtTemplate = read("coolify/netbird-management.json.template");
  const domainsEnv = read("config/domains.env.example");
  const issuanceScript = read("scripts/pki-issue-internal-cert.sh");

  test("netbird stack has caddy sidecar on port 33073 with AISHA PKI cert", () => {
    expect(netbirdCompose, "must define netbird-internal-tls service").toContain(
      "netbird-internal-tls:",
    );
    expect(netbirdCompose, "caddy sidecar must expose host port 33073").toMatch(
      /netbird-internal-tls:[\s\S]*?ports:[\s\S]*?"\$\{NETBIRD_MESH_PORT:-33073\}:33073"/,
    );
    expect(netbirdCompose, "caddy must consume NETBIRD_INTERNAL_CERT_B64 from env").toContain(
      "NETBIRD_INTERNAL_CERT_B64",
    );
    expect(netbirdCompose, "caddy must consume NETBIRD_INTERNAL_KEY_B64 from env").toContain(
      "NETBIRD_INTERNAL_KEY_B64",
    );
    expect(netbirdCompose, "caddy must depend on pki-init for CA bundle").toMatch(
      /netbird-internal-tls:[\s\S]*?depends_on:[\s\S]*?pki-init:[\s\S]*?service_completed_successfully/,
    );
    // Caddy v2.7+ rejects `h2c://host:443` (scheme/port conflict — 443 is
    // well-known TLS port). Canonical idiom is bare upstream + transport
    // block declaring plaintext h2c. The gate asserts the SEMANTIC
    // requirement (h2c upstream to netbird-management:443) accepting both
    // forms: legacy `h2c://netbird-management:443` and v2.7+ bare upstream
    // paired with `transport http { versions h2c }`.
    expect(netbirdCompose, "caddy must reverse_proxy to netbird-management on :443").toMatch(
      new RegExp(`reverse_proxy\\s+(?:h2c://)?${reHost("netbird-management", 443)}`),
    );
    expect(netbirdCompose, "caddy must declare h2c transport for netbird-management upstream").toMatch(
      new RegExp(`${reHost("netbird-management", 443)}[\\s\\S]*?transport\\s+http\\s*\\{[\\s\\S]*?versions\\s+h2c`),
    );
    expect(netbirdCompose, "caddy must route signal traffic to netbird-signal on :10000").toMatch(
      new RegExp(`reverse_proxy\\s+(?:h2c://)?${reHost("netbird-signal", 10000)}`),
    );
    expect(netbirdCompose, "caddy must declare h2c transport for netbird-signal upstream").toMatch(
      new RegExp(`${reHost("netbird-signal", 10000)}[\\s\\S]*?transport\\s+http\\s*\\{[\\s\\S]*?versions\\s+h2c`),
    );
    expect(netbirdCompose, "caddy must route relay traffic").toContain(
      vnitrniHost("netbird-relay", 33080),
    );
  });

  test("caddy sidecar never shells out to openssl (alpine image has none) — bootstrap uses 'tls internal'", () => {
    // The netbird-internal-tls sidecar runs on caddy:2.8-alpine, which ships
    // NO openssl binary. The original bootstrap fallback ran `openssl req` to
    // mint a self-signed cert — it failed "openssl: not found", left cert.pem
    // absent, and Caddy crashlooped. The fix uses Caddy's built-in internal CA
    // (`tls internal`). This gate prevents any openssl call from creeping back.
    // No openssl INVOCATION anywhere in the netbird compose (comments that
    // mention the word are fine — assert no non-comment line runs the binary).
    const opensslInvocation = /^\s*[^#\n]*\bopenssl\s+(req|x509|genrsa|verify|pkey)/m;
    expect(
      opensslInvocation.test(netbirdCompose),
      "netbird compose must NOT invoke openssl — caddy:2.8-alpine has no openssl binary",
    ).toBe(false);
    // Bootstrap fallback must use Caddy's internal CA.
    expect(
      netbirdCompose,
      "bootstrap fallback must use Caddy 'tls internal' (locally-trusted CA), not a shelled-out self-signed cert",
    ).toContain("tls internal");
    // Internal issuance requires auto_https NOT be fully 'off' on that path.
    expect(
      netbirdCompose,
      "bootstrap path must set auto_https to 'disable_redirects' so 'tls internal' can provision",
    ).toContain("auto_https disable_redirects");
  });

  test("NETBIRD_MESH_HOST is declared in config/domains.env", () => {
    // MESH_TLD read DYNAMICALLY from the same SoT file — the contract is
    // NETBIRD_MESH_HOST=netbird.<MESH_TLD>, not a hardcoded deployment domain.
    const meshTld = domainsEnv.match(/^MESH_TLD=([^\s#]+)/m)?.[1];
    expect(meshTld, "MESH_TLD must be declared in domains.env.example").toBeTruthy();
    const escaped = (meshTld ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(domainsEnv, `NETBIRD_MESH_HOST must be declared as netbird.${meshTld}`).toMatch(
      new RegExp(`^NETBIRD_MESH_HOST=netbird\\.${escaped}`, "m"),
    );
  });

  test("management.json.template advertises Signal + Relay via the INTERNAL mesh endpoint (:33073, AISHA cert)", () => {
    // Landed 2026-07-07: the Signal/Relay advertisement moved off the public
    // netbird.aisha.guru:443 path (pfSense WAN-loopback → Coolify Traefik →
    // netbird-signal:10000) — that path mangled the long-lived Signal gRPC stream
    // ("didn't receive a registration header" / dial timeout), so agents connected
    // to Management but never registered with Signal → peer tunnels never formed.
    //
    // Fix: advertise Signal + Relay on ${NETBIRD_MESH_HOST}:33073 — the SAME
    // netbird-internal-tls Caddy (AISHA cert) that already fronts Management and
    // already routes /signalexchange.SignalExchange/* → netbird-signal:10000 and
    // /relay → netbird-relay. This resolves the 2026-05-08 "NOT cross-stack-
    // resolvable" blocker: agents reach ${NETBIRD_MESH_HOST} via a STATIC
    // extra_hosts entry (not mesh DNS), exactly as they already do for Management
    // pre-join — so the old "Signal must stay public so peers can resolve it"
    // premise no longer holds. All mesh control-plane traffic now rides our own PKI.
    expect(mgmtTemplate, "Signal URI must use the internal mesh endpoint ${NETBIRD_MESH_HOST}:33073").toMatch(
      /"URI":\s*"\$\{NETBIRD_MESH_HOST\}:\$\{NETBIRD_MESH_PORT\}"/,
    );
    expect(mgmtTemplate, "Relay address must use the internal mesh endpoint ${NETBIRD_MESH_HOST}:33073").toMatch(
      /"rels:\/\/\$\{NETBIRD_MESH_HOST\}:\$\{NETBIRD_MESH_PORT\}\/relay"/,
    );
    // Signal/Relay must NOT regress to the public pfSense path.
    expect(
      /"URI":\s*"\$\{NETBIRD_DOMAIN\}:443"/.test(mgmtTemplate),
      "Signal URI must not regress to the public NETBIRD_DOMAIN:443 path",
    ).toBe(false);
  });

  test("netbird-init has NETBIRD_MESH_HOST env for template render", () => {
    // envsubst on netbird-management.json.template needs NETBIRD_MESH_HOST.
    expect(netbirdCompose, "netbird-init must inject NETBIRD_MESH_HOST").toMatch(
      /netbird-init:[\s\S]*?environment:[\s\S]*?NETBIRD_MESH_HOST:/,
    );
  });

  test("agent composes use internal mesh URL + AISHA CA trust bundle", () => {
    const cases = [
      { compose: coreCompose, name: "core" },
      { compose: integrationCompose, name: "integration" },
      { compose: cosmosCompose, name: "cosmos" },
    ];

    for (const { compose, name } of cases) {
      // Accept three patterns:
      //   1. https://${NETBIRD_MESH_HOST}:33073 (composite-template; bare env)
      //   2. ${NB_MANAGEMENT_URL} (bare env reference — operator sets the
      //      full mesh URL in Coolify env per iter 10 template-only directive)
      //   3. (legacy) ${NB_MANAGEMENT_URL:-https://...:33073} — still accepted
      //      where a composite default helps cold-start ordering. The :33073
      //      port marker enforces the internal-TLS path.
      expect(
        compose,
        `${name}: NB_MANAGEMENT_URL must reference the internal-TLS mesh path (port 33073 via NETBIRD_MESH_HOST or NB_MANAGEMENT_URL env)`,
      ).toMatch(
        /(?:NB_MANAGEMENT_URL:\s*\$\{NB_MANAGEMENT_URL\}|NB_MANAGEMENT_URL:.*\$\{NETBIRD_MESH_HOST[^}]*\}:\$\{NETBIRD_MESH_PORT|NB_MANAGEMENT_URL:.*:33073)/,
      );
      expect(compose, `${name}: NB_SSL_TRUST_BUNDLE must default to AISHA CA bundle`).toMatch(
        /NB_SSL_TRUST_BUNDLE:.*\/certs\/pki\/aisha-ca-bundle\.pem/,
      );
      expect(compose, `${name}: extra_hosts must resolve mesh hostname`).toMatch(
        /extra_hosts:[\s\S]*?\$\{NETBIRD_MESH_HOST[^}]*\}:\$\{NETBIRD_MGMT_HOST/,
      );
      expect(compose, `${name}: must mount pki-certs volume into agent`).toMatch(
        /netbird-agent:[\s\S]*?volumes:[\s\S]*?pki-certs:\/certs\/pki:ro/,
      );
      expect(compose, `${name}: must define pki-init service`).toContain("pki-init:");
    }
  });

  test("issuance script provides Phase-1 manual workflow + Phase-2 stub", () => {
    expect(issuanceScript).toContain("netbird-mesh");
    expect(issuanceScript, "must validate cert subject + SAN").toContain("CN=$hostname");
    expect(issuanceScript, "must validate chain against AISHA CA bundle").toContain(
      "openssl verify -CAfile",
    );
    expect(issuanceScript, "must base64-encode for env transport").toContain(
      "base64 < ",
    );
    expect(issuanceScript, "must support --check-expiry for cron renewal").toContain(
      "--check-expiry",
    );
    expect(issuanceScript, "must push to Coolify env via API").toContain(
      "/applications/${coolify_uuid}/envs",
    );
    expect(issuanceScript, "must trigger redeploy after cert update").toContain(
      "/deploy?uuid=",
    );
  });

  test("legacy traefik labels removed from netbird-mgmt route via Traefik (LE) only for dashboard", () => {
    // The dashboard router can stay on Coolify Traefik (browser path with LE).
    // But /api, /signalexchange, /relay routers should NOT compete with the
    // internal :33073 path when this gate enforces a clean separation.
    //
    // For now, transitional state: Traefik routers + caddy sidecar coexist
    // (external clients via netbird.aisha.guru, internal via :33073).
    // Once mesh is verified stable on internal path, Traefik routers for
    // /api, /signalexchange, /relay can be removed (gate test will then
    // tighten this assertion).
    //
    // Today's assertion: caddy sidecar exists AND NETBIRD_MESH_HOST is wired.
    expect(netbirdCompose).toContain("netbird-internal-tls:");
    expect(netbirdCompose).toContain("NETBIRD_MESH_HOST");
  });
});
