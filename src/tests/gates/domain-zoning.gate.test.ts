/**
 * domain-zoning.gate.test.ts
 *
 * Vynucuje doménový kontrakt definovaný v `config/domains.env.example`:
 *
 *   PUBLIC zone:    *.<PUBLIC_TLD> — frontend only, koncoví uživatelé / externí klienti
 *   INTERNAL zone:  <svc>.<server>.<INTERNAL_TLD> — admin/ops, per-server wildcard
 *
 * Pravidla:
 *   1. PUBLIC_KEYS musí mít doménu v *.<PUBLIC_TLD>
 *   2. INTERNAL_KEYS musí mít doménu v <svc>.<server>.<INTERNAL_TLD>
 *      kde <server> ∈ {frontend, backend, experimental, build}
 *   3. Žádný :port v doménové hodnotě
 *   4. Derived URLs jsou konzistentní (https:// prefix, žádný port)
 */

// Iter 15: config/domains.env is template-only (empty SoT). The reference
// deploy contract that THIS gate verifies lives in config/domains.env.example.
// Operators forking the repo populate their domains via .env-prod-backup;
// this gate enforces structural integrity of the AISHA reference deploy.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getServerRoles } from "./lib/domain-topology";

const REPO = path.resolve(__dirname, "../../..");
// Iter 15: live config/domains.env is template-only (empty SoT). The
// AISHA reference deploy contract this gate enforces lives in the .example.
const DOMAINS_FILE = path.join(REPO, "config", "domains.env.example");

// Server roles read DYNAMICALLY from the topology SoT (coolify/servers.json)
// via the shared helper — not hardcoded — so the zoning contract stays dynamic.
const KNOWN_SERVERS = [...getServerRoles()];

const PUBLIC_KEYS = [
  "APP_DOMAIN",
  "API_DOMAIN_PUBLIC",
  "KEYCLOAK_DOMAIN_PUBLIC",
  "AUTH_DOMAIN_PUBLIC",
  "MCP_DOMAIN",
  "DIRIGENT_DOMAIN",
  "NETBIRD_DOMAIN",
  "REGISTRY_DOMAIN",
  "STUDIO_DOMAIN", // pgAdmin — OAuth2-Proxy chráněný, ale public endpoint (db.aisha.guru)
] as const;

const INTERNAL_KEYS = [
  "API_DOMAIN",
  "KEYCLOAK_DOMAIN",
  "N8N_DOMAIN",
  "LANGFUSE_DOMAIN",
  "MATRIX_DOMAIN",
  "ELEMENT_DOMAIN",
  "ELEMENT_CALL_DOMAIN",
  "LIVEKIT_DOMAIN",
  "TURN_DOMAIN",
  "PKI_DOMAIN",
  "NOCODB_DOMAIN",
  "APPSMITH_DOMAIN",
  "INTRANET_DOMAIN",
  "DOZZLE_DOMAIN",
] as const;

function loadEnv(file: string): Record<string, string> {
  const txt = fs.readFileSync(file, "utf8");
  const out: Record<string, string> = {};
  for (const raw of txt.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/\s+#.*$/, "").trim();
  }
  // expand ${X} (single pass, no recursion needed for our schema)
  for (const k of Object.keys(out)) {
    out[k] = out[k].replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, n) => out[n] ?? "");
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("Domain zoning contract (config/domains.env)", () => {
  let env: Record<string, string>;

  beforeAll(() => {
    expect(fs.existsSync(DOMAINS_FILE), `Missing ${DOMAINS_FILE}`).toBe(true);
    env = loadEnv(DOMAINS_FILE);
  });

  it("all PUBLIC_KEYS are defined and use PUBLIC_TLD", () => {
    const publicSuffix = `.${env.PUBLIC_TLD}`;
    for (const key of PUBLIC_KEYS) {
      const val = env[key];
      expect(val, `${key} is missing in domains.env`).toBeTruthy();
      expect(val, `${key}=${val} must be in *${publicSuffix} zone`).toMatch(
        new RegExp(`^[a-z0-9-]+\\.${escapeRegExp(env.PUBLIC_TLD)}$`),
      );
    }
  });

  it("all INTERNAL_KEYS use <svc>.<server>.<INTERNAL_TLD> with known server", () => {
    const re = new RegExp(`^[a-z0-9-]+\\.(${KNOWN_SERVERS.join("|")})\\.${escapeRegExp(env.INTERNAL_TLD)}$`);
    for (const key of INTERNAL_KEYS) {
      const val = env[key];
      expect(val, `${key} is missing in domains.env`).toBeTruthy();
      expect(val, `${key}=${val} must be in <svc>.<server>.${env.INTERNAL_TLD} zone`).toMatch(re);
    }
  });

  it("no port number in any domain value", () => {
    for (const key of [...PUBLIC_KEYS, ...INTERNAL_KEYS]) {
      const val = env[key] ?? "";
      expect(val, `${key}=${val} must not contain a port`).not.toMatch(/:\d+/);
    }
  });

  it("PUBLIC and INTERNAL domains must not overlap zones", () => {
    for (const key of PUBLIC_KEYS) {
      expect(env[key] ?? "", `${key} leaks into ${env.INTERNAL_TLD}`).not.toMatch(new RegExp(`\\.${escapeRegExp(env.INTERNAL_TLD)}$`));
    }
    for (const key of INTERNAL_KEYS) {
      expect(env[key] ?? "", `${key} leaks into ${env.PUBLIC_TLD}`).not.toMatch(new RegExp(`\\.${escapeRegExp(env.PUBLIC_TLD)}$`));
    }
  });

  it("derived URLs are https and reference defined domains", () => {
    const expectations: Array<[string, string]> = [
      ["KEYCLOAK_URL", `https://${env.KEYCLOAK_DOMAIN}`],
      ["AISHA_API_URL", `https://${env.API_DOMAIN}`],
      ["AISHA_BACKEND_URL", `https://${env.API_DOMAIN}`],
      ["NETBIRD_API_URL", `https://${env.NETBIRD_DOMAIN}`],
      ["PUBLIC_SITE_URL", `https://${env.APP_DOMAIN}`],
      ["VITE_API_URL", `https://${env.API_DOMAIN_PUBLIC}`],
      ["VITE_AISHA_BACKEND_URL", `https://${env.API_DOMAIN_PUBLIC}`],
      ["VITE_AISHA_GATEWAY_URL", `https://${env.API_DOMAIN_PUBLIC}`],
      ["VITE_KC_URL", `https://${env.AUTH_DOMAIN_PUBLIC}`],
      ["VITE_KC_AUTHORITY", `https://${env.AUTH_DOMAIN_PUBLIC}/realms/aisha`],
      ["VITE_AUTH_REDIRECT_URI", `https://${env.APP_DOMAIN}/auth/callback`],
      ["VITE_AUTH_POST_LOGOUT_URI", `https://${env.APP_DOMAIN}`],
      ["RAGNAROK_URL", `https://${env.API_DOMAIN}`],
      ["LIVEKIT_WEBHOOK_URL", `https://${env.API_DOMAIN}/functions/v1/livekit-webhook`],
      ["MATRIX_WEBHOOK_URL", `https://${env.API_DOMAIN}/functions/v1/matrix-webhook`],
      ["TURN_REALM", env.TURN_DOMAIN],
      ["SYNAPSE_SERVER_NAME", env.MATRIX_DOMAIN],
    ];
    for (const [key, expected] of expectations) {
      expect(env[key], `${key} should be ${expected}`).toBe(expected);
    }
    expect(env.ALLOWED_ORIGINS, "ALLOWED_ORIGINS").toBe(
      `https://${env.APP_DOMAIN},https://${env.API_DOMAIN_PUBLIC},https://${env.API_DOMAIN}`,
    );
  });
});
