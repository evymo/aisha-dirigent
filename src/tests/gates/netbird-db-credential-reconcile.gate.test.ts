/**
 * netbird-db credential-reconcile gate.
 *
 * Incident 2026-07-05 (mesh down): netbird-db was a plain postgres:17-alpine on a
 * reused volume. Postgres writes role passwords only on FIRST init, so a rotated
 * NETBIRD_DB_PASSWORD stranded the DB on the old password → netbird-management
 * crashed right after "using Postgres store engine" → the whole mesh stayed down.
 * The fix builds netbird-db from Dockerfile.netbird-db, whose entrypoint is the
 * GENERIC infra/db-reconcile/postgres-reconcile-entrypoint.sh — env-driven and
 * instance-agnostic (never references the per-deploy container name), so any
 * fork/tenant/DB reuses the same script.
 *
 * This gate guards the wiring + the generic+safe properties so a refactor cannot
 * silently drop them (behaviour is covered by the docker drift test in the PR,
 * which needs a live Postgres and cannot run in CI).
 */

import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const DOCKERFILE = join(ROOT, "Dockerfile.netbird-db");
const ENTRYPOINT = join(ROOT, "infra/db-reconcile/postgres-reconcile-entrypoint.sh");
const COMPOSE = join(ROOT, "docker-compose.coolify-netbird.yml");

describe("netbird-db credential reconcile", () => {
  test("Dockerfile.netbird-db installs + entrypoints the GENERIC postgres reconcile", () => {
    const df = readFileSync(DOCKERFILE, "utf8");
    expect(df).toMatch(/COPY[^\n]*db-reconcile\/postgres-reconcile-entrypoint\.sh/);
    expect(df).toMatch(/ENTRYPOINT\s*\[\s*"[^"]*postgres-reconcile-entrypoint\.sh"\s*\]/);
    expect(df).toMatch(/CMD\s*\[\s*"postgres"\s*\]/);
  });

  test("compose builds netbird-db from the reconcile Dockerfile (not the bare image)", () => {
    const c = readFileSync(COMPOSE, "utf8");
    const end = c.indexOf("\n  netbird-management:");
    const svc = c.slice(c.indexOf("\n  netbird-db:"), end >= 0 ? end : undefined);
    expect(svc).toMatch(/dockerfile:\s*Dockerfile\.netbird-db/);
    expect(svc).not.toMatch(/^\s*image:\s*\$\{REGISTRY_PROXY\}library\/postgres/m);
  });

  test("entrypoint exists and is executable", () => {
    expect(existsSync(ENTRYPOINT)).toBe(true);
    expect(statSync(ENTRYPOINT).mode & 0o111).not.toBe(0);
  });

  test("entrypoint is GENERIC (env-driven, no service-specific role hardcoded)", () => {
    const s = readFileSync(ENTRYPOINT, "utf8");
    // superuser is POSTGRES_USER, never a hardcoded role name
    expect(s).toMatch(/POSTGRES_USER/);
    expect(s).not.toMatch(/rolname\s*=\s*'netbird_app'/); // no baked-in netbird role
    // never references the (per-deploy) container name
    expect(s).not.toMatch(/container_name|--name|docker ps|\$HOSTNAME/);
  });

  test("entrypoint reconciles over local socket, quotes passwords safely, hands off", () => {
    const s = readFileSync(ENTRYPOINT, "utf8");
    expect(s).toMatch(/\/var\/run\/postgresql/); // local peer/trust — recovers a stranded volume
    expect(s).toMatch(/ALTER ROLE/);
    expect(s).toMatch(/ON_ERROR_STOP/); // loud on failure
    // passwords passed as psql :'vars' (server-side quoted) — no raw interpolation
    expect(s).toMatch(/:'su_pw'/);
    expect(s).toMatch(/exec\s+docker-entrypoint\.sh\s+"\$@"/);
  });

  test("marker records a fingerprint, never the secret value", () => {
    const s = readFileSync(ENTRYPOINT, "utf8");
    expect(s).toMatch(/sha256sum/);
    expect(s).toMatch(/\.postgres-cred-reconciled/);
    expect(s).not.toMatch(/>[^\n]*\$\{?(NETBIRD_DB_PASSWORD|POSTGRES_PASSWORD)\}?[^\n]*\.postgres-cred-reconciled/);
  });
});
