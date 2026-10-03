/**
 * Local DB connection resolver — shared by all `--local` scripts.
 *
 * Resolution order (same logic, one place):
 *
 *   1. AISHA_LOCAL_DB_URL  — explicit override; set this when connecting to the
 *      local-warmup stack (port 54322, password dev_postgres_password) rather than
 *      the e2e stack default below.
 *   2. Default             — postgresql://postgres:postgres@127.0.0.1:57422/postgres
 *      (the e2e stack; kept as default so CI and test:e2e callers need no change).
 *
 * Usage examples:
 *
 *   # e2e stack (default — no env var needed):
 *   npm run db:seed:local
 *
 *   # local-warmup stack (port 54322):
 *   AISHA_LOCAL_DB_URL=postgresql://postgres:dev_postgres_password@127.0.0.1:54322/postgres \
 *     npm run db:seed:local
 *
 *   # Or set AISHA_LOCAL_DB_URL once in your shell profile / .env.local for the session.
 *
 *   3. .env.ports          — the dynamic free-port allocation (scripts/local/ports.mjs).
 *      Read automatically when neither of the above is set, so db scripts + tests
 *      follow a stack that was brought up on a non-default port (conflict-proof)
 *      without anyone having to export anything.
 *
 * @module
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Read a var from scripts/local/.env.ports, if the port allocator has run. */
function fromEnvPorts(key) {
  try {
    const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "local", ".env.ports");
    if (!existsSync(p)) return undefined;
    const m = readFileSync(p, "utf8").match(new RegExp(`^${key}=(.+)$`, "m"));
    return m ? m[1].trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Fallback when AISHA_LOCAL_DB_URL is not set — the e2e/CI stack coordinates. */
export const DEFAULT_LOCAL_DB_URL =
  "postgresql://postgres:postgres@127.0.0.1:57422/postgres";

/**
 * Parse a postgres:// URL into the individual connection fields expected by
 * psql's -h/-p/-U/-d flags and PGPASSWORD.
 *
 * @param {string} url  A `postgresql://user:pass@host:port/db` URL.
 * @returns {{ host: string, port: number, user: string, password: string, database: string }}
 */
export function parseLocalDbUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname || "127.0.0.1",
    port: Number(u.port) || 5432,
    user: decodeURIComponent(u.username) || "postgres",
    password: decodeURIComponent(u.password) || "postgres",
    database: (u.pathname || "/postgres").slice(1) || "postgres",
  };
}

/**
 * The resolved connection URL: AISHA_LOCAL_DB_URL if set, otherwise the
 * e2e/CI default.  Scripts that need a URL string (for example DB typegen
 * --db-url) use this directly.
 */
export const localDbUrl =
  process.env.AISHA_LOCAL_DB_URL ?? fromEnvPorts("AISHA_LOCAL_DB_URL") ?? DEFAULT_LOCAL_DB_URL;

/**
 * Structured connection object for scripts that pass -h/-p/-U/-d to psql.
 * Derived from `localDbUrl` above.
 */
export const LOCAL_DB = parseLocalDbUrl(localDbUrl);
