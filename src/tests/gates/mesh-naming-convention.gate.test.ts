/**
 * Mesh Naming Convention Gate
 *
 * Asserts the AISHA platform follows a deterministic naming convention for
 * domains and mesh hostnames, expressed declaratively via env vars in
 * `config/domains.env.example` rather than hardcoded across the compose tree.
 *
 * Convention:
 *   PUBLIC_TLD      (user-facing routes)
 *   INTERNAL_TLD    (admin via per-server <svc>.<server>.<INTERNAL_TLD>)
 *   MESH_TLD        (peer-to-peer NetBird DNS)
 *   DIRIGENT_DOMAIN (MCP/n8n public alias #2)
 *
 * Why: makes the convention explicit and reusable; lets compose files reference
 * `${PUBLIC_TLD}` / `${MESH_TLD}` instead of repeating literals everywhere.
 *
 * Spouští se přes: npm run test:gates
 */

// Iter 15: config/domains.env is template-only (empty SoT). The reference
// deploy contract that THIS gate verifies lives in config/domains.env.example.
// Operators forking the repo populate their domains via .env-prod-backup;
// this gate enforces structural integrity of the AISHA reference deploy.

import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function loadDomainsEnv(): Record<string, string> {
  const path = join(ROOT, "config/domains.env.example");
  if (!existsSync(path)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    // Strip inline comment (` #` not inside quotes) and surrounding quotes/spaces
    let raw = m[2];
    if (!raw.startsWith('"') && !raw.startsWith("'")) {
      const hashIdx = raw.indexOf(" #");
      if (hashIdx >= 0) raw = raw.slice(0, hashIdx);
    }
    env[m[1]] = raw.trim().replace(/^['"]|['"]$/g, "");
  }
  // Resolve nested ${VAR} references (single pass)
  for (const k of Object.keys(env)) {
    env[k] = env[k].replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name) => env[name] ?? "");
  }
  return env;
}

describe("Domain TLD convention", () => {
  const env = loadDomainsEnv();

  test("PUBLIC_TLD is declared", () => {
    expect(env.PUBLIC_TLD, "config/domains.env must declare PUBLIC_TLD").toBeTruthy();
  });

  test("INTERNAL_TLD is declared", () => {
    expect(env.INTERNAL_TLD, "config/domains.env must declare INTERNAL_TLD").toBeTruthy();
  });

  test("MESH_TLD is declared", () => {
    expect(env.MESH_TLD, "config/domains.env must declare MESH_TLD").toBeTruthy();
  });

  test("PUBLIC_TLD is a domain suffix, not an empty placeholder", () => {
    expect(env.PUBLIC_TLD).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
  });

  test("INTERNAL_TLD is a domain suffix, not an empty placeholder", () => {
    expect(env.INTERNAL_TLD).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
  });

  test("MESH_TLD is a domain suffix, not an empty placeholder", () => {
    expect(env.MESH_TLD).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
  });

  test("DIRIGENT_DOMAIN is declared and is a public alias", () => {
    expect(env.DIRIGENT_DOMAIN, "DIRIGENT_DOMAIN missing").toBeTruthy();
    expect(env.DIRIGENT_DOMAIN!.endsWith(`.${env.PUBLIC_TLD}`)).toBe(true);
  });
});

describe("Public domains end with .${PUBLIC_TLD}", () => {
  const env = loadDomainsEnv();
  const publicVars = ["APP_DOMAIN", "NETBIRD_DOMAIN", "REGISTRY_DOMAIN", "MCP_DOMAIN", "DIRIGENT_DOMAIN", "STUDIO_DOMAIN"];

  for (const v of publicVars) {
    test(`${v} ends with .${env.PUBLIC_TLD || "<unset>"}`, () => {
      const value = env[v];
      if (!value) return; // not set is fine; declared optional
      expect(
        value.endsWith(`.${env.PUBLIC_TLD}`),
        `${v}=${value} must end with .${env.PUBLIC_TLD}`,
      ).toBe(true);
    });
  }
});

describe("Internal domains match <svc>.<server>.${INTERNAL_TLD}", () => {
  const env = loadDomainsEnv();
  // Internal-zone vars from existing config (admin, dev, ops endpoints)
  const internalVars = [
    "API_DOMAIN", "STUDIO_DOMAIN_DIRECT", "KEYCLOAK_DOMAIN", "N8N_DOMAIN",
    "LANGFUSE_DOMAIN", "MATRIX_DOMAIN", "ELEMENT_DOMAIN", "ELEMENT_CALL_DOMAIN",
    "LIVEKIT_DOMAIN", "TURN_DOMAIN", "PKI_DOMAIN", "NOCODB_DOMAIN",
    "APPSMITH_DOMAIN", "INTRANET_DOMAIN", "DOZZLE_DOMAIN",
  ];
  const knownServers = ["frontend", "backend", "experimental", "build"];

  for (const v of internalVars) {
    test(`${v} matches <svc>.<server>.${env.INTERNAL_TLD || "<unset>"}`, () => {
      const value = env[v];
      if (!value) return;
      const re = new RegExp(`^[a-z][a-z0-9-]*\\.(${knownServers.join("|")})\\.${env.INTERNAL_TLD!.replace(/\./g, "\\.")}$`);
      expect(
        re.test(value),
        `${v}=${value} must match <svc>.<server>.${env.INTERNAL_TLD} where <server> ∈ {${knownServers.join(",")}}`,
      ).toBe(true);
    });
  }
});

describe("Mesh hostnames end with .${MESH_TLD}", () => {
  const env = loadDomainsEnv();

  // ⛔ 2026-09-13: tady stály testy BACKEND_MESH_HOST („if declared") a
  // CORE_MESH_HOST (`env.CORE_MESH_HOST || core.${MESH_TLD}`). Oba klíče byly
  // MRTVÉ — nečetl je žádný kód a z .example je odstranila brána
  // example-neni-zdroj-hodnot. Oba testy by pak prošly nad prázdnem (první
  // `return`, druhý nad hodnotou, kterou si sám složil). Přepsáno na vlastnost:
  // KAŽDÉ mesh jméno, které referenční kontrakt dokumentuje, leží v MESH_TLD.
  const meshHosts = Object.entries(env).filter(([k]) => /_MESH_HOST$/.test(k));

  test("referenční kontrakt nese aspoň jedno mesh jméno (jinak test níž nic neměří)", () => {
    expect(meshHosts.map(([k]) => k)).toContain("NETBIRD_MESH_HOST");
  });

  test("každé *_MESH_HOST v .example končí .${MESH_TLD}", () => {
    const mimoZonu = meshHosts.filter(([, v]) => !v.endsWith(`.${env.MESH_TLD}`)).map(([k, v]) => `${k}=${v}`);
    expect(mimoZonu).toEqual([]);
  });
});
