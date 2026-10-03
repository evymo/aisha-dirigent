import { describe, expect, test } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf8");
}

/**
 * Gate test: NetBird account ownership is claimed by a real Keycloak user.
 *
 * Why this exists:
 *   NetBird's first authenticated request creates an account with the
 *   requester as owner. If `netbird-bootstrap.sh` runs first as the
 *   `netbird-backend` service account, the service-account user UUID
 *   becomes account owner. NetBird's IDP user-sync then loops on
 *   "user not found in IDP" because Keycloak's regular user listing
 *   excludes service accounts. Heartbeats fail. Mesh stays broken.
 *
 * The fix:
 *   - Realm has `aisha-bootstrap` Keycloak user (regular, not service account)
 *   - Realm has `aisha-bootstrap` Keycloak client (confidential, ROPC-enabled)
 *   - `scripts/aisha-bootstrap-user-init.sh` provisions password + secret dynamically
 *   - `scripts/netbird-bootstrap.sh` runs ROPC first → user becomes account owner
 *   - `scripts/aisha-cold-start.sh` wires both in correct order
 *
 * Each piece is verified below. Without all of them, mesh fix breaks.
 */
describe("NetBird account owner — systemic fix gate", () => {
  test("aisha-bootstrap Keycloak client is defined with ROPC + netbird audience", () => {
    const realm = JSON.parse(read("keycloak/aisha-realm.json")) as {
      clients: Array<{
        clientId: string;
        publicClient?: boolean;
        directAccessGrantsEnabled?: boolean;
        serviceAccountsEnabled?: boolean;
        standardFlowEnabled?: boolean;
        protocolMappers?: Array<{ name: string; config?: { "included.custom.audience"?: string } }>;
      }>;
    };

    const client = realm.clients.find((c) => c.clientId === "aisha-bootstrap");
    expect(client, "aisha-bootstrap client must exist in realm").toBeDefined();
    if (!client) return;

    expect(client.publicClient, "aisha-bootstrap must be confidential (publicClient=false)").toBe(false);
    expect(client.directAccessGrantsEnabled, "aisha-bootstrap must enable ROPC (directAccessGrantsEnabled=true)").toBe(true);
    expect(client.serviceAccountsEnabled, "aisha-bootstrap must NOT have its own service account").toBe(false);
    expect(client.standardFlowEnabled, "aisha-bootstrap is ROPC-only — disable browser flow").toBe(false);

    const audMapper = client.protocolMappers?.find((p) => p.config?.["included.custom.audience"] === "netbird");
    expect(audMapper, "aisha-bootstrap must have a netbird audience mapper").toBeDefined();
  });

  test("aisha-bootstrap Keycloak user exists with NO inline credentials", () => {
    const realm = JSON.parse(read("keycloak/aisha-realm.json")) as {
      users: Array<{
        username: string;
        email?: string;
        enabled?: boolean;
        credentials?: unknown[];
        realmRoles?: string[];
      }>;
    };

    const user = realm.users.find((u) => u.username === "aisha-bootstrap");
    expect(user, "aisha-bootstrap user must exist in realm").toBeDefined();
    if (!user) return;

    expect(user.enabled, "aisha-bootstrap must be enabled").toBe(true);
    expect(user.email, "aisha-bootstrap must have an email (Keycloak validation)").toBeTruthy();
    expect(
      user.credentials ?? [],
      "aisha-bootstrap must NOT have inline credentials — password is set dynamically by aisha-bootstrap-user-init.sh",
    ).toEqual([]);
  });

  test("aisha-bootstrap-user-init.sh provisions secrets dynamically", () => {
    const script = read("scripts/aisha-bootstrap-user-init.sh");

    // Expected behaviors:
    expect(script, "must source from .env.coolify").toContain("ENV_FILE");
    // Master admin (admin-cli) is the integral pattern — universal privileges,
    // no role coupling to netbird-backend service account (which is reserved
    // for NetBird IDP user-sync). KC's --import-realm OVERWRITE_EXISTING does
    // NOT update existing service account role assignments, so coupling here
    // would silently break on every realm re-import.
    expect(script, "must use master admin-cli password grant for KC admin API").toMatch(/realms\/master\/protocol\/openid-connect\/token[\s\S]+?client_id=admin-cli/);
    expect(script, "must NOT couple to netbird-backend SA for KC admin API").not.toMatch(/client_id=netbird-backend[\s\S]+?client_secret=/);
    expect(script, "must resolve aisha-bootstrap user via admin API").toContain("users?username=aisha-bootstrap");
    expect(script, "must resolve aisha-bootstrap client via admin API").toContain("clientId=aisha-bootstrap");
    expect(script, "must fetch/regenerate the client secret").toContain("/client-secret");
    expect(script, "must generate dynamic password if missing").toContain("openssl rand");
    expect(script, "must set the user password via reset-password endpoint").toContain("/reset-password");
    expect(script, "must verify ROPC works end-to-end before exiting").toContain("grant_type=password");
    expect(script, "must persist AISHA_BOOTSTRAP_PASSWORD").toContain("AISHA_BOOTSTRAP_PASSWORD");
    expect(script, "must persist AISHA_BOOTSTRAP_CLIENT_SECRET").toContain("AISHA_BOOTSTRAP_CLIENT_SECRET");
  });

  test("netbird-bootstrap.sh claims account ownership BEFORE ensure_group", () => {
    const script = read("scripts/netbird-bootstrap.sh");

    expect(script, "must define the ownership claim function").toContain("claim_account_ownership_as_bootstrap_user");
    expect(script, "must use ROPC (grant_type=password) on aisha-bootstrap client").toContain('client_id=aisha-bootstrap');
    expect(script, "must read AISHA_BOOTSTRAP_PASSWORD from env").toContain("AISHA_BOOTSTRAP_PASSWORD");
    expect(script, "must read AISHA_BOOTSTRAP_CLIENT_SECRET from env").toContain("AISHA_BOOTSTRAP_CLIENT_SECRET");
    expect(script, "NetBird API auth must prefer aisha-bootstrap user token").toContain("bootstrap_user_token");
    expect(script, "fresh DB reset must allow setup key regeneration").toContain("FORCE_RECREATE_SETUP_KEYS");

    // Ordering: ownership claim must precede ensure_group calls
    const claimIdx = script.indexOf("claim_account_ownership_as_bootstrap_user");
    const firstGroupIdx = script.indexOf('ensure_group aisha-frontend');
    expect(claimIdx, "ownership claim function must be defined before group provisioning").toBeGreaterThan(0);
    expect(firstGroupIdx, "group provisioning must exist").toBeGreaterThan(0);

    // The CALL to claim_account_ownership... must be before group provisioning.
    const claimCallIdx = script.indexOf(
      "banner \"Cold-start account ownership claim",
    );
    expect(claimCallIdx, "ownership claim banner must be invoked").toBeGreaterThan(0);
    expect(claimCallIdx).toBeLessThan(firstGroupIdx);
  });

  test("aisha-cold-start.sh wires bootstrap user provisioning between Keycloak and NetBird", () => {
    const script = read("scripts/aisha-cold-start.sh");

    expect(script, "cold-start must call aisha-bootstrap-user-init.sh").toContain(
      "scripts/aisha-bootstrap-user-init.sh",
    );

    // Ordering: bootstrap user init must run AFTER Keycloak realm import,
    // BEFORE the netbird-bootstrap.sh INVOCATION (not just any mention).
    const realmIdx = script.indexOf("configure-realms.sh");
    const bootstrapUserIdx = script.indexOf("scripts/aisha-bootstrap-user-init.sh");
    // Use the actual `bash ... scripts/netbird-bootstrap.sh` invocation, not
    // earlier comments that mention it by name.
    const netbirdBootstrapIdx = script.indexOf('bash "${REPO_ROOT}/scripts/netbird-bootstrap.sh"');

    expect(realmIdx, "configure-realms.sh must be invoked").toBeGreaterThan(0);
    expect(bootstrapUserIdx, "scripts/aisha-bootstrap-user-init.sh must be invoked").toBeGreaterThan(0);
    expect(netbirdBootstrapIdx, "netbird-bootstrap.sh invocation must exist").toBeGreaterThan(0);

    expect(realmIdx).toBeLessThan(bootstrapUserIdx);
    expect(bootstrapUserIdx).toBeLessThan(netbirdBootstrapIdx);
  });

  test("NetBird sidecars expose NB_FORCE_REENROLL to runtime environment", () => {
    const composeFiles = [
      "docker-compose.coolify.yml",
      "docker-compose.coolify-prebuilt.yml",
      "docker-compose.coolify-integration.yml",
      "docker-compose.coolify-cosmos.yml",
    ];

    for (const composeFile of composeFiles) {
      const compose = read(composeFile);
      expect(compose, `${composeFile} must pass NB_FORCE_REENROLL into the NetBird container`).toContain(
        "NB_FORCE_REENROLL: ${NB_FORCE_REENROLL:-0}",
      );
    }
  });
});
