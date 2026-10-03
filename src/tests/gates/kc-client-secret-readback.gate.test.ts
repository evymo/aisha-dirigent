/**
 * Keycloak client-secret provisioning — read-back verify, never trust the PUT
 *
 * WHY (same family as the 2026-07-17 cold-start fixes):
 *   provision-sso.sh `set_client_secret()` PUTs `{"secret": X}` to Keycloak and
 *   used to treat a 204/200 as success. Keycloak has no first-class "set secret to
 *   X" API — the function's own inline note admits it — and some KC versions
 *   silently IGNORE the update, answering 204 while keeping their own value. If we
 *   trust that code and then persist X to .env.coolify + the container env, KC and
 *   the app hold DIFFERENT secrets, so every OIDC consumer (oauth2-proxy for
 *   admin/observability, the gateway, and the `netbird-backend` service account
 *   that netbird-bootstrap.sh authenticates with) gets `invalid_client`. That
 *   surfaces only much later as a wave-4 / Phase-D auth failure with no obvious
 *   link back to the secret-set step.
 *
 *   This is the same class as domain-doctor's silent-drop (Coolify 200 that did not
 *   persist): the write MUST be verified by reading it back — the response code is
 *   not proof the value stuck. KC exposes the read-back at
 *   GET /admin/realms/{realm}/clients/{uuid}/client-secret → {"type","value"}.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PROVISION_SSO = join(ROOT, "scripts/provision-sso.sh");

describe("Keycloak client-secret — read-back verify", () => {
  const src = readFileSync(PROVISION_SSO, "utf-8");

  // Bound the set_client_secret function body.
  const fn = (() => {
    const start = src.indexOf("set_client_secret()");
    if (start < 0) return "";
    // The next top-level `}` at column 0 closes the function.
    const rest = src.slice(start);
    const end = rest.search(/\n\}\s*(\n|$)/);
    return end > -1 ? rest.slice(0, end) : rest;
  })();

  test("set_client_secret() reads the secret back from Keycloak", () => {
    expect(fn, "could not locate set_client_secret() in provision-sso.sh").not.toBe("");
    expect(
      fn,
      "set_client_secret must GET /clients/{uuid}/client-secret to read the stored secret back — the PUT's 204/200 is not proof it persisted.",
    ).toMatch(/clients\/\$\{client_uuid\}\/client-secret/);
    expect(
      fn,
      "the read-back must extract the `.value` field from KC's {type,value} response.",
    ).toMatch(/\.value/);
  });

  test("success requires the read-back to MATCH the intended secret (not just an HTTP code)", () => {
    expect(
      fn,
      "the success branch must compare the read-back value to the intended `$secret`, not only the PUT HTTP status.",
    ).toMatch(/"\$actual_secret"\s*==\s*"\$secret"|\$actual_secret.*==.*\$secret/);
  });

  test("a non-persisted secret fails LOUD with the invalid_client consequence", () => {
    expect(
      fn,
      "on read-back mismatch, set_client_secret must fail (return 1) and name the invalid_client impact so the failure is traceable.",
    ).toMatch(/invalid_client/i);
    expect(fn, "the mismatch path must return 1 (not report success).").toMatch(/return 1/);
  });
});
