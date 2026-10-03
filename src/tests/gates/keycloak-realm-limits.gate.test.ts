/**
 * Keycloak realm import limits — a field longer than its column blocks startup.
 *
 * WHY (2026-07-19): `authenticationFlows[].description` for "aisha first broker
 * login" was 454 characters. Keycloak's AUTHENTICATION_FLOW.DESCRIPTION column is
 * varchar(255), so the realm import aborted with
 * `ERROR: value too long for type character varying(255)` and Keycloak
 * crash-looped. Nothing downstream could start: it is the OIDC dependency of the
 * whole wave.
 *
 * It survived review because it only fires on a FRESH database. An instance
 * whose realm was already imported never re-runs the insert, so the value can sit
 * in the repo indefinitely and only detonate on the next wipe or new install —
 * exactly when the operator has the least room to debug it.
 *
 * Derived from Keycloak's own schema widths, not a style rule about prose length.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DIR = join(ROOT, "keycloak");

// Keycloak schema widths for the fields a realm export can carry.
const LIMITS: Array<{ collection: string; field: string; max: number }> = [
  { collection: "authenticationFlows", field: "description", max: 255 },
  { collection: "authenticationFlows", field: "alias", max: 255 },
  { collection: "groups", field: "name", max: 255 },
];

describe("keycloak realm import limits", () => {
  test("no realm field exceeds its database column", () => {
    const offenders: string[] = [];
    const files = existsSync(DIR)
      ? readdirSync(DIR).filter((f) => f.endsWith(".json") && f.includes("realm"))
      : [];
    expect(files.length, "no realm JSON found — check the path").toBeGreaterThan(0);

    for (const file of files) {
      let realm: Record<string, unknown>;
      try {
        realm = JSON.parse(readFileSync(join(DIR, file), "utf8"));
      } catch (err) {
        offenders.push(`${file}: unparsable (${(err as Error).message})`);
        continue;
      }
      for (const { collection, field, max } of LIMITS) {
        for (const item of (realm[collection] as Array<Record<string, unknown>>) ?? []) {
          const value = item?.[field];
          if (typeof value === "string" && value.length > max) {
            offenders.push(
              `${file}: ${collection}[${item.alias ?? item.name}].${field} = ${value.length} chars (max ${max})`,
            );
          }
        }
      }
    }

    expect(
      offenders,
      `realm import would fail on a FRESH database:\n  ${offenders.join("\n  ")}\n` +
        "Shorten the value; put the long rationale in a comment or docs, not in a column.",
    ).toEqual([]);
  });
});
