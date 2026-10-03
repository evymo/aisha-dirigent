/**
 * CLASS gate — never use Coolify PREDEFINED (reserved) vars in compose env
 *
 * WHY (family #11 of the 2026-07-17 cold-start bug set):
 *   Coolify injects its own values for a set of PREDEFINED variables per container —
 *   COOLIFY_URL, COOLIFY_FQDN, COOLIFY_CONTAINER_NAME, COOLIFY_RESOURCE_UUID, … — pointing
 *   at THAT app's own resource. A compose that references `${COOLIFY_URL}` to reach the
 *   operator's Coolify SERVER therefore gets the app's own URL (https://<uuid>.<tld>)
 *   instead, even though the app env carries the correct operator value: Coolify's reserved
 *   value shadows it at runtime. aisha-pki-renewer built COOLIFY_API from `${COOLIFY_URL}`,
 *   so it called the app's own URL /api/v1 → HTTP 404 → the consumer-app lookup
 *   failed → *.mesh certs were issued but never distributed → netbird sidecars never enrolled.
 *
 *   The operator's Coolify server URL is available UN-reserved as COOLIFY_BASE_URL
 *   (env-doctor emits it as an alias of COOLIFY_URL). Compose env MUST use that, never the
 *   reserved names. Instance gates can't catch the next file that reaches for ${COOLIFY_URL};
 *   this class gate does.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
// Coolify-reserved / predefined vars that Coolify overrides per-app at runtime.
const RESERVED = ["COOLIFY_URL", "COOLIFY_FQDN", "COOLIFY_CONTAINER_NAME", "COOLIFY_RESOURCE_UUID"];
const RESERVED_RE = new RegExp(`\\$\\{(${RESERVED.join("|")})[:}]`);

describe("CLASS: no Coolify-reserved var referenced in compose env", () => {
  const composes = readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f));

  test("compose files never reference a Coolify PREDEFINED var (use COOLIFY_BASE_URL etc.)", () => {
    const violations: string[] = [];
    for (const file of composes) {
      const lines = readFileSync(join(ROOT, file), "utf-8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (line.trim().startsWith("#")) continue;
        if (RESERVED_RE.test(line)) {
          violations.push(`${file}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      }
    }
    expect(
      violations,
      "Compose references a Coolify PREDEFINED (reserved) variable — Coolify overrides it per-app " +
        "with that app's own resource value, shadowing the operator value. Use the un-reserved alias " +
        "(COOLIFY_BASE_URL for the server URL):\n" +
        violations.join("\n"),
    ).toEqual([]);
  });

  test("the gate actually recognises a reserved-var reference (self-check)", () => {
    expect(RESERVED_RE.test('COOLIFY_API: "${COOLIFY_URL}/api/v1"')).toBe(true);
    expect(RESERVED_RE.test('COOLIFY_API: "${COOLIFY_BASE_URL}/api/v1"')).toBe(false);
  });
});
