import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf8");
}

function exists(relPath: string): boolean {
  return existsSync(join(ROOT, relPath));
}

/**
 * Gate test: svc-pki-bridge — autonomous certificate issuance via JWT + OpenXPKI RPC.
 *
 * Why this exists:
 *   AISHA's internal mesh (NetBird) requires TLS certificates signed by our
 *   own AISHA PKI (Evymo Root CA). Manual cert issuance via WebUI violates
 *   the self-healing principle: no human should be in the renewal loop.
 *
 *   svc-pki-bridge is the machine consumer of JWT tokens issued to
 *   `aisha-pki-bootstrap` (Keycloak ROPC client, audience=pki-proxy).
 *   It validates the JWT, generates a PKCS#10 CSR, submits it to OpenXPKI
 *   RPC with HMAC authentication, and returns the signed cert + key.
 *
 *   Without this service the `aud=pki-proxy` audience claim on the bootstrap
 *   token has no consumer — the Keycloak client exists but nobody validates
 *   the tokens for machine cert issuance.
 *
 *   This gate ensures the bridge service exists, follows project conventions,
 *   is wired into the PKI compose stack, and the OpenXPKI RPC config allows
 *   auto-approved enrollment for mesh domains.
 */
describe("svc-pki-bridge — autonomous PKI cert issuance", () => {
  // ── Service scaffold ──────────────────────────────────────────────

  test("svc-pki-bridge directory exists with required files", () => {
    const svcDir = "services/svc-pki-bridge";
    expect(exists(svcDir), "services/svc-pki-bridge/ must exist").toBe(true);
    expect(exists(`${svcDir}/package.json`), "package.json must exist").toBe(true);
    expect(exists(`${svcDir}/tsconfig.json`), "tsconfig.json must exist").toBe(true);
    expect(exists(`${svcDir}/src/server.ts`), "src/server.ts must exist").toBe(true);
    expect(exists(`${svcDir}/src/config.ts`), "src/config.ts must exist").toBe(true);
    expect(exists(`${svcDir}/src/auth.ts`), "src/auth.ts (JWT validation) must exist").toBe(true);
  });

  test("package.json follows service conventions", () => {
    const pkg = JSON.parse(read("services/svc-pki-bridge/package.json"));
    expect(pkg.name, "package name must be @aisha scoped").toBe("@aisha/svc-pki-bridge");
    expect(pkg.type, "must use ESM").toBe("module");
    expect(pkg.private, "must be private").toBe(true);
    expect(pkg.dependencies, "must have fastify").toHaveProperty("fastify");
    expect(pkg.dependencies, "must have jose for JWT validation").toHaveProperty("jose");
    expect(pkg.dependencies, "must have pino for logging").toHaveProperty("pino");
  });

  // ── JWT auth layer ────────────────────────────────────────────────

  test("auth module validates JWT with aud=pki-proxy audience", () => {
    const auth = read("services/svc-pki-bridge/src/auth.ts");
    expect(auth, "must import jose for JWT verification").toContain("jose");
    expect(auth, "must validate audience claim").toMatch(/audience|aud/);
    expect(auth, "must reference pki-proxy audience").toContain("pki-proxy");
  });

  test("config references expected env vars for Keycloak + OpenXPKI", () => {
    const config = read("services/svc-pki-bridge/src/config.ts");
    expect(config, "must read KEYCLOAK_URL").toContain("KEYCLOAK_URL");
    expect(config, "must read KEYCLOAK_REALM").toContain("KEYCLOAK_REALM");
    expect(config, "must read OPENPKI_RPC_URL for OpenXPKI endpoint").toMatch(
      /OPENPKI_RPC_URL|OPENXPKI_RPC_URL/,
    );
    expect(config, "must read OPENPKI_RPC_HMAC for request signing").toMatch(
      /OPENPKI_RPC_HMAC|OPENXPKI_RPC_HMAC/,
    );
    expect(config, "must define port").toContain("PORT");
  });

  // ── OpenXPKI RPC client ───────────────────────────────────────────

  test("has OpenXPKI RPC client module for cert issuance", () => {
    expect(
      exists("services/svc-pki-bridge/src/openxpki-rpc.ts"),
      "src/openxpki-rpc.ts must exist",
    ).toBe(true);
    const rpc = read("services/svc-pki-bridge/src/openxpki-rpc.ts");
    expect(rpc, "must reference RequestCertificate RPC command").toContain("RequestCertificate");
    expect(rpc, "must include HMAC calculation for RPC auth").toMatch(/hmac|HMAC/);
    expect(rpc, "must handle pkcs10 CSR submission").toContain("pkcs10");
    expect(rpc, "must parse certificate response").toMatch(/certificate|cert_identifier/);
  });

  // ── Issue endpoint ────────────────────────────────────────────────

  test("server exposes POST /v1/issue endpoint + /health", () => {
    const server = read("services/svc-pki-bridge/src/server.ts");
    expect(server, "must register issue route").toMatch(/issue|issueRoutes/);
    expect(server, "must have /health endpoint").toContain("/health");
  });

  test("issue route module validates requested SAN against allowed patterns", () => {
    expect(
      exists("services/svc-pki-bridge/src/routes/issue.ts"),
      "src/routes/issue.ts must exist",
    ).toBe(true);
    const issue = read("services/svc-pki-bridge/src/routes/issue.ts");
    expect(issue, "must validate SAN hostname pattern").toMatch(
      /mesh\.aisha\.internal|mesh\.aisha\.network|ALLOWED_SAN|sanPattern/,
    );
    expect(issue, "must reject unauthorized SAN patterns").toMatch(/403|forbidden|unauthorized/i);
  });

  // ── Compose integration ───────────────────────────────────────────

  test("pki-bridge is wired into docker-compose.coolify-pki.yml", () => {
    const pkiCompose = read("docker-compose.coolify-pki.yml");
    expect(pkiCompose, "must define pki-bridge service").toContain("pki-bridge:");
    expect(pkiCompose, "pki-bridge must depend on pki-webui").toMatch(
      /pki-bridge:[\s\S]*?depends_on:[\s\S]*?pki-webui/,
    );
    expect(pkiCompose, "pki-bridge must be on internal network").toMatch(
      /pki-bridge:[\s\S]*?networks:[\s\S]*?internal/,
    );
    expect(pkiCompose, "pki-bridge must consume OPENXPKI_RPC_HMAC from env").toMatch(
      /OPENPKI_RPC_HMAC|OPENXPKI_RPC_HMAC/,
    );
    expect(pkiCompose, "pki-bridge must not depend on runtime shared HMAC files").not.toMatch(
      /pki-shared|rpc-hmac\.key/,
    );
    const bridgeBlock = pkiCompose.match(/^\s+pki-bridge:[\s\S]+?(?=\n {2}[a-z]|\nvolumes:|\nnetworks:)/m)?.[0] ?? "";
    const dependsBlock = bridgeBlock.match(/^\s{4}depends_on:\n[\s\S]+?(?=^\s{4}[a-zA-Z_-]+:)/m)?.[0] ?? "";
    expect(
      dependsBlock,
      "pki-bridge reaches rendered OpenXPKI config through pki-webui; direct pki-init dependency is redundant",
    ).not.toMatch(/pki-init/);
  });

  test("pki-renewer sidecar is the unified mesh-cert issuer (client_credentials)", () => {
    const pkiCompose = read("docker-compose.coolify-pki.yml");
    expect(pkiCompose, "must define pki-renewer service").toContain("pki-renewer:");
    expect(pkiCompose, "pki-renewer must depend on pki-bridge").toMatch(
      /pki-renewer:[\s\S]*?depends_on:[\s\S]*?pki-bridge/,
    );
    const renewerBlock =
      pkiCompose.match(/^\s+pki-renewer:[\s\S]+?(?=\n {2}[a-z]|\nvolumes:|\nnetworks:)/m)?.[0] ?? "";
    // The renewer authenticates to pki-bridge with OAuth2 client_credentials via a
    // dedicated confidential SERVICE-ACCOUNT (aisha-pki-issuer, aud=pki-proxy),
    // NOT the old ROPC bootstrap user/password. See infra/pki/pki-renewer.sh +
    // scripts/aisha-bootstrap-user-init.sh (Step 10b).
    expect(
      renewerBlock,
      "pki-renewer must authenticate via client_credentials (aisha-pki-issuer)",
    ).toMatch(/PKI_ISSUER_CLIENT_SECRET|AISHA_PKI_ISSUER_CLIENT_SECRET|aisha-pki-issuer/);
    expect(
      renewerBlock,
      "pki-renewer must NOT regress to the ROPC bootstrap user/password grant",
    ).not.toMatch(/PKI_BOOTSTRAP_PASSWORD|grant_type=password/);
    // Runs the unified issuer script (issue via pki-bridge → distribute cert to
    // the consumer's Coolify env → reload).
    expect(renewerBlock, "pki-renewer runs the unified issuer script").toMatch(/pki-renewer\.sh/);
    // The issuer script itself must exist and use the client_credentials grant.
    const renewerScript = read("infra/pki/pki-renewer.sh");
    expect(renewerScript, "issuer script uses client_credentials grant").toMatch(
      /grant_type=client_credentials/,
    );
  });

  // ── Apache RPC proxy ───────────────────────────────────────────────

  test("Apache serves RPC on HTTP port 80 (pki-bridge → pki-webui internal)", () => {
    const apacheConf = read(
      "openxpki-config/contrib/apache2-openxpki-site.conf",
    );
    // pki-bridge calls http://pki-webui:80/rpc (plain HTTP, internal Docker net).
    // Apache VirtualHost *:80 MUST proxy /rpc to the OpenXPKI client socket.
    // Without this, /rpc on port 80 falls through to 404 (only HTTPS had the rule).
    expect(
      apacheConf,
      "port 80 VirtualHost must have RPC rewrite rule",
    ).toMatch(/<VirtualHost \*:80>[\s\S]*?RewriteRule.*rpc[\s\S]*?<\/VirtualHost>/);
  });

  test("pki-webui healthcheck follows the Apache OpenXPKI health endpoint", () => {
    const pkiCompose = read("docker-compose.coolify-pki.yml");
    const webuiBlock = pkiCompose.match(/^\s+pki-webui:[\s\S]+?(?=\n {2}[a-z]|\nvolumes:|\nnetworks:)/m)?.[0] ?? "";

    expect(
      webuiBlock,
      "pki-webui must set a deterministic Apache ServerName so startup logs do not carry AH00558 as normal noise.",
    ).toContain("ServerName pki-webui");
    expect(
      webuiBlock,
      "healthcheck must not probe `/`; the OpenXPKI vhost redirects root to HTTPS and the internal cert is self-signed.",
    ).not.toMatch(/wget[^\n]*http:\/\/localhost:80\/\s/);
    expect(
      webuiBlock,
      "healthcheck must use GET against OpenXPKI's built-in Apache health endpoint via the clientd socket proxy.",
    ).toContain("http://localhost:80/healthcheck/ping");
  });

  test("pki-init generates an end-entity WebUI TLS cert, not a CA cert", () => {
    const pkiCompose = read("docker-compose.coolify-pki.yml");
    const pkiInitBlock = pkiCompose.match(/^\s+pki-init:[\s\S]+?(?=\n {2}[a-z]|\nvolumes:|\nnetworks:)/m)?.[0] ?? "";

    expect(pkiInitBlock).toContain("basicConstraints=critical,CA:FALSE");
    expect(pkiInitBlock).toContain("extendedKeyUsage=serverAuth");
    expect(pkiInitBlock).toContain("subjectAltName=DNS:pki-webui,DNS:aisha-pki-webui,DNS:localhost,IP:127.0.0.1");
  });

  // ── OpenXPKI RPC auto-approval config ─────────────────────────────

  test("orchestration-plane RPC config allows mesh domain auto-enrollment", () => {
    const rpcConfig = read(
      "openxpki-config/config.d/realm/orchestration-plane/rpc/generic.yaml",
    );
    // The HMAC secret must NOT be the default placeholder
    expect(rpcConfig, "HMAC must not be default 'verysecret'").not.toMatch(
      /^hmac:\s*verysecret\s*$/m,
    );
    // Eligible connector must match mesh domains (not just openxpki.test)
    expect(rpcConfig, "eligible regex must cover mesh.aisha.internal").toMatch(
      /mesh\.aisha\.(network|internal)|aisha/,
    );
  });

  // ── Keycloak client consistency ───────────────────────────────────

  test("aisha-pki-bootstrap client in realm.json has audience=pki-proxy", () => {
    const realm = JSON.parse(read("keycloak/aisha-realm.json"));
    const clients = realm.clients ?? [];
    const pkiClient = clients.find(
      (c: Record<string, unknown>) => c.clientId === "aisha-pki-bootstrap",
    );
    expect(pkiClient, "aisha-pki-bootstrap client must exist in realm.json").toBeDefined();
    expect(
      pkiClient.directAccessGrantsEnabled,
      "must have ROPC enabled",
    ).toBe(true);
    // Check audience mapper targets pki-proxy
    const mappers = (pkiClient.protocolMappers ?? []) as Array<Record<string, unknown>>;
    const audMapper = mappers.find((m) =>
      String(m.name ?? "").includes("audience"),
    );
    expect(audMapper, "must have audience mapper").toBeDefined();
    const audConfig = audMapper?.config as Record<string, unknown> | undefined;
    expect(
      audConfig?.["included.custom.audience"],
      "audience mapper must target pki-proxy",
    ).toBe("pki-proxy");
  });
});
