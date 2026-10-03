/**
 * Postgres Grants Gate
 *
 * Static check of `infra/postgres/000_init_roles_schemas.sql` and
 * `infra/postgres/entrypoint-wrapper.sh` to ensure that every service role:
 *
 * 1. Has `GRANT CONNECT ON DATABASE postgres`
 * 2. Has its schema grants (`USAGE, CREATE ON SCHEMA <name>`)
 * 3. Has `GRANT CREATE ON DATABASE postgres` if the service performs
 *    schema introspection at startup (n8n 1.79+, synapse, langfuse)
 * 4. Init SQL never accidentally `GRANT ... TO PUBLIC` (security)
 *
 * The n8n_app `GRANT CREATE ON DATABASE postgres` was the root cause of a
 * deployment regression — n8n bootstrap requires CREATE on db to verify
 * schema existence even when DB_POSTGRESDB_SCHEMA is set to a pre-created
 * schema. Without that grant, n8n crashes at startup.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const INIT_SQL = readFileSync(join(ROOT, "infra/postgres/000_init_roles_schemas.sql"), "utf-8");
const ENTRYPOINT = readFileSync(join(ROOT, "infra/postgres/entrypoint-wrapper.sh"), "utf-8");

/**
 * needsExplicitConnect = true means the service role MUST have an explicit
 *   `GRANT CONNECT ON DATABASE postgres` (typically because it creates schemas
 *   or modifies database-level state at startup).
 * Roles without it rely on default PUBLIC CONNECT privilege — fine until
 *   anyone runs `REVOKE ALL ON DATABASE postgres FROM PUBLIC`.
 *
 * synapse_user is intentionally absent: it lives in a dedicated `synapse`
 *   database created by `synapse-db-init` in docker-compose.coolify-matrix.yml,
 *   not in init_roles_schemas.sql.
 */
const SERVICE_ROLES = [
  { role: "n8n_app", schema: "n8n", needsExplicitConnect: true, needsCreateOnPostgres: true },
  { role: "keycloak_app", schema: "keycloak", needsExplicitConnect: true, needsCreateOnPostgres: false },
  { role: "netbird_app", schema: "netbird", needsExplicitConnect: true, needsCreateOnPostgres: false },
  { role: "langfuse_app", schema: "langfuse", needsExplicitConnect: false, needsCreateOnPostgres: false },
  { role: "nocodb_app", schema: "public", needsExplicitConnect: false, needsCreateOnPostgres: false },
];

describe("Postgres init — role connectivity", () => {
  test("roles that need explicit CONNECT have GRANT CONNECT ON DATABASE postgres", () => {
    const missing = SERVICE_ROLES.filter((r) => {
      if (!r.needsExplicitConnect) return false;
      const re = new RegExp(`GRANT CONNECT ON DATABASE \\w+ TO ${r.role}`);
      return !re.test(INIT_SQL);
    });
    expect(
      missing.map((r) => r.role),
      "Service roles that bootstrap schemas need explicit CONNECT (defensive against REVOKE FROM PUBLIC)",
    ).toEqual([]);
  });
});

describe("Postgres init — schema privileges", () => {
  test("each service role has USAGE, CREATE on its dedicated schema", () => {
    const missing = SERVICE_ROLES.filter((r) => {
      if (!r.schema) return false;
      const re = new RegExp(`GRANT USAGE,?\\s*CREATE ON SCHEMA ${r.schema} TO ${r.role}`);
      return !re.test(INIT_SQL);
    });
    expect(
      missing.map((r) => `${r.role} (schema: ${r.schema})`),
      "Service roles need USAGE+CREATE on their schema",
    ).toEqual([]);
  });
});

describe("Postgres init — n8n bootstrap requirement", () => {
  test("n8n_app has GRANT CREATE ON DATABASE postgres", () => {
    expect(
      /GRANT CREATE ON DATABASE \w+ TO n8n_app/.test(INIT_SQL),
      "n8n 1.79+ verifies schema existence at startup which requires CREATE on database. Without this grant, n8n crashes during bootstrap.",
    ).toBe(true);
  });

  test("entrypoint-wrapper.sh idempotently re-applies n8n_app GRANT CREATE", () => {
    expect(
      /GRANT CREATE ON DATABASE \w+ TO n8n_app/.test(ENTRYPOINT),
      "entrypoint-wrapper.sh must idempotently re-apply the GRANT — Coolify volumes can lose grants on full re-init",
    ).toBe(true);
  });
});

describe("Postgres init — no accidental PUBLIC grants", () => {
  test("no GRANT ... TO PUBLIC in init SQL (security)", () => {
    const lines = INIT_SQL.split("\n");
    const violations: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith("--")) continue;
      if (/GRANT\s+[^;]+TO\s+PUBLIC[\s;,]/i.test(line)) {
        violations.push(`infra/postgres/000_init_roles_schemas.sql:${i + 1} — ${line.trim()}`);
      }
    }
    expect(
      violations,
      "GRANT TO PUBLIC exposes privileges to every login role including unauthenticated — explicit grants only",
    ).toEqual([]);
  });
});

describe("Postgres init — role hygiene", () => {
  test("every CREATE ROLE statement uses NOLOGIN or LOGIN explicitly", () => {
    const violations: string[] = [];
    const lines = INIT_SQL.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith("--")) continue;
      const m = line.match(/CREATE ROLE\s+(\w+)\s+(.*)/i);
      if (!m) continue;
      if (!/\bLOGIN\b|\bNOLOGIN\b/i.test(m[2])) {
        violations.push(`infra/postgres/000_init_roles_schemas.sql:${i + 1} — role ${m[1]} missing explicit LOGIN/NOLOGIN`);
      }
    }
    expect(
      violations,
      "Roles should declare LOGIN or NOLOGIN explicitly (default LOGIN can be surprising)",
    ).toEqual([]);
  });

  test("authenticator role uses NOINHERIT (PostgREST switching pattern)", () => {
    expect(
      /CREATE ROLE authenticator\s+LOGIN\s+NOINHERIT/i.test(INIT_SQL),
      "PostgREST role-switching gateway requires NOINHERIT so SET ROLE switches don't leak privileges",
    ).toBe(true);
  });
});
