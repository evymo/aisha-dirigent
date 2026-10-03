/**
 * Local env completeness — generator hard-fail on silent-empty ${VAR}
 *
 * Closes the local-warmup root-cause class behind the KEYCLOAK_DOMAIN_PUBLIC bug
 * (PR #336): a bare `${VAR}` referenced in a Coolify compose file but absent from
 * config/local-presets.mjs devEnvDefaults is substituted by `docker compose
 * config` with a BLANK STRING + only a stderr warning, so malformed config
 * (empty hosts/secrets) reaches the local stack silently.
 *
 * scripts/local-compose-gen.mjs now reads `docker compose config` stderr (via
 * spawnSync), parses the "<VAR> variable is not set" warnings
 * (scripts/lib/env-completeness.mjs parseUnsetVarWarnings), aggregates them across
 * the selected apps, and EXITS NON-ZERO with the exact list. This gate asserts
 * the parser, the wiring, and that the previously-missing vars stay declared.
 *
 * String/logic-level (no docker) — CI-portable.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseUnsetVarWarnings } from "../../../scripts/lib/env-completeness.mjs";
import { devEnvDefaults } from "../../../config/local-presets.mjs";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf-8");

describe("Local env completeness", () => {
  test("parseUnsetVarWarnings extracts names from docker's escaped-quote warnings", () => {
    const stderr = [
      'time="x" level=warning msg="The \\"KEYCLOAK_DOMAIN_PUBLIC\\" variable is not set. Defaulting to a blank string."',
      'level=warning msg="The \\"N8N_DB_USER\\" variable is not set. Defaulting to a blank string."',
    ].join("\n");
    expect(parseUnsetVarWarnings(stderr)).toEqual(["KEYCLOAK_DOMAIN_PUBLIC", "N8N_DB_USER"]);
  });

  test("dedupes + sorts; tolerates plain-quote form, unrelated lines, empty/undefined", () => {
    const dup = 'msg="The \\"B\\" variable is not set" \n msg="The \\"A\\" variable is not set" \n msg="The \\"B\\" variable is not set"';
    expect(parseUnsetVarWarnings(dup)).toEqual(["A", "B"]);
    expect(parseUnsetVarWarnings('The "FOO_BAR" variable is not set')).toEqual(["FOO_BAR"]); // plain quotes
    expect(parseUnsetVarWarnings("")).toEqual([]);
    expect(parseUnsetVarWarnings("some unrelated log line")).toEqual([]);
    expect(parseUnsetVarWarnings(undefined)).toEqual([]);
  });

  test("generator wires the hard-fail: reads stderr, aggregates, exits non-zero", () => {
    const gen = read("scripts/local-compose-gen.mjs");
    expect(gen, "imports the parser").toMatch(/parseUnsetVarWarnings[\s\S]*from[\s\S]*env-completeness/);
    expect(
      gen,
      "renderComposeJson must read stderr via spawnSync (execFileSync drops stderr on success)",
    ).toMatch(/spawnSync[\s\S]*parseUnsetVarWarnings\(r\.stderr/);
    expect(gen, "aggregates unset vars across apps").toMatch(/allUnsetVars\.add/);
    expect(
      gen,
      "must EXIT NON-ZERO when any bare var is missing (no silent generation)",
    ).toMatch(/allUnsetVars\.size > 0[\s\S]*process\.exit\(1\)/);
  });

  test("previously silent-empty vars stay declared in devEnvDefaults (regression guard)", () => {
    // The exact gap closed: preset-reachable bare ${VAR}s + the :? required
    // PKI_DEFAULT_SECRET that errored `--preset full`. Dropping any re-opens the
    // silent-empty hole (or re-breaks `full`).
    const required = [
      "KEYCLOAK_DOMAIN_PUBLIC", "INTRANET_DOMAIN", "MATRIX_DOMAIN", "COOLIFY_URL",
      "N8N_DB_HOST", "N8N_DB_NAME", "N8N_DB_PORT", "N8N_DB_USER",
      "N8N_OIDC_SECRET", "N8N_COOKIE_SECRET", "OAUTH2_PROXY_COOKIE_SECRET",
      "APPSMITH_INTRANET_OIDC_SECRET", "NB_MANAGEMENT_URL",
      "NOCODB_ADMIN_EMAIL", "NOCODB_ADMIN_PASSWORD",
      "KRONOS_API_KEY", "MAESTRO_API_KEY", "PKI_CLIENT_KEY_B64",
      "REGISTRY_PROXY", "PKI_DEFAULT_SECRET",
      // Local parity with the prod env-sync-before-redeploy fix: dropping either
      // from devEnvDefaults would re-open a silent-empty Redis password locally
      // (prod's realtime WRONGPASS incident 2026-06-13 was the same class).
      "REDIS_PASSWORD_CORE", "REDIS_PASSWORD",
      // OpenClaw (optional executor) — the optimum-ai/full-light/full presets now run its
      // compose, whose :?-required (OPENCLAW_DB_PASSWORD/OPENCLAW_OIDC_SECRET) + bare
      // (OPENCLAW_API_KEY/OPENCLAW_SECRET/OPENCLAW_DOMAIN/COMPANION_DOMAIN) vars would
      // hard-fail `docker compose config` if devEnvDefaults dropped them (the trio added
      // openclaw to the local presets; this gate-locks its env parity, docker-free).
      "OPENCLAW_DB_PASSWORD", "OPENCLAW_OIDC_SECRET", "OPENCLAW_API_KEY",
      "OPENCLAW_SECRET", "OPENCLAW_DOMAIN", "COMPANION_DOMAIN",
    ];
    const missing = required.filter((k) => !(k in devEnvDefaults));
    expect(missing, `devEnvDefaults must declare these (else silent-empty / full errors): ${missing.join(", ")}`).toEqual([]);
  });

  test("secrets/passwords/DB-config got real values, not empty (empty would break the app)", () => {
    const mustBeNonEmpty = [
      "N8N_OIDC_SECRET", "N8N_COOKIE_SECRET", "OAUTH2_PROXY_COOKIE_SECRET",
      "APPSMITH_INTRANET_OIDC_SECRET", "PKI_DEFAULT_SECRET",
      "NOCODB_ADMIN_PASSWORD", "N8N_DB_HOST", "N8N_DB_USER", "N8N_DB_NAME", "N8N_DB_PORT",
      "KEYCLOAK_DOMAIN_PUBLIC", "COOLIFY_URL",
    ];
    for (const k of mustBeNonEmpty) {
      expect(String((devEnvDefaults as Record<string, unknown>)[k] ?? "").length, `${k} must be a non-empty dev value`).toBeGreaterThan(0);
    }
  });
});
