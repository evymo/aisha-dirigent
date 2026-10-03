/**
 * Test Environment Capability Probe
 *
 * Auto-detects what test capabilities are available in the current environment.
 * Replaces the old DB_VALIDATION=true allowlist with environment-driven detection.
 *
 * Principles:
 * - Auto-detect, don't allowlist. If capabilities are available, run; otherwise skip gracefully.
 * - Suppression only via env vars (AISHA_SKIP_DB_TESTS=1, AISHA_SKIP_AI_TESTS=1),
 *   never via in-code allowlists for technical debt.
 * - One source of truth for capability detection across all DB tests.
 *
 * Capabilities probed:
 * - PostgREST endpoint (production RPC path)
 * - Direct PostgreSQL access (meta-queries via psql/pg_isready)
 * - MLX (Apple Silicon AI validation)
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { ZNACKA_DB_NEDOSTUPNA } from "../../../scripts/lib/rohatka-test-db.mjs";

const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");

// =============================================================================
// Environment Variables
// =============================================================================

/**
 * PostgREST URL — production RPC path. Tests that exercise real RPC behavior
 * should probe this endpoint, not raw psql.
 *
 * Default: http://localhost:3000 (typical local PostgREST dev port)
 * Override via POSTGREST_URL or AISHA_POSTGREST_URL env vars.
 */
export const POSTGREST_URL =
  process.env.AISHA_POSTGREST_URL ||
  process.env.POSTGREST_URL ||
  "http://localhost:3000";

/**
 * Direct PostgreSQL connection — only for meta-queries (information_schema,
 * pg_proc, pg_policies) that PostgREST does not expose. Tests should prefer
 * PostgREST RPC for behavior validation.
 *
 * Defaults match common local dev: host 127.0.0.1, port 54322 (legacy local
 * dev port — still used by docker-compose dev stacks).
 */
export const PG_HOST = process.env.AISHA_DB_HOST || process.env.PGHOST || "127.0.0.1";
export const PG_PORT = process.env.AISHA_DB_PORT || process.env.PGPORT || "54322";
export const PG_USER = process.env.AISHA_DB_USER || process.env.PGUSER || "postgres";
export const PG_PASSWORD = process.env.AISHA_DB_PASSWORD || process.env.PGPASSWORD || "postgres";
export const PG_DATABASE = process.env.AISHA_DB_NAME || process.env.PGDATABASE || "postgres";

/** Opt-out: suppress all DB-dependent tests even if capabilities exist. */
export const SKIP_DB_TESTS = process.env.AISHA_SKIP_DB_TESTS === "1";

/**
 * Povinná DB — nastavuje ji rohatka celé sady (scripts/test/test-db-rohatka.mjs).
 * Nedostupná DB pak NENÍ „přeskoč", ale chyba se značkou ZNACKA_DB_NEDOSTUPNA:
 * rohatka z ní pozná NEZMĚŘENO (75), ne zelenou ani nový pád.
 *
 * ⛔ Rozbor #1113 (2026-09-28): sonda má strop 3 s / 5 s; pod zátěží sdíleného
 * runneru vypršela, celý soubor se přeskočil (skipIf) a rohatka ho započetla
 * jako změřený — „dutá zelená". V povinném režimu se proto zkouší víckrát
 * s delším stropem a neúspěch je hlasitý.
 */
export const DB_POVINNA = process.env.AISHA_TESTDB_POVINNA === "1";

/** Opt-out: suppress AI tests even if MLX is installed. */
export const SKIP_AI_TESTS = process.env.AISHA_SKIP_AI_TESTS === "1";

// =============================================================================
// PostgREST Reachability
// =============================================================================

/**
 * HTTP probe of PostgREST root — returns true if PostgREST responds with
 * any HTTP status (404 is fine, just means it's alive).
 *
 * Cached per process to avoid hammering the endpoint across many tests.
 */
let _postgrestReachable: boolean | null = null;

export async function isPostgrestReachable(): Promise<boolean> {
  if (_postgrestReachable !== null) return _postgrestReachable;
  if (SKIP_DB_TESTS) return (_postgrestReachable = false);

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${POSTGREST_URL}/`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(t);
    _postgrestReachable = res.status > 0;
  } catch {
    _postgrestReachable = false;
  }
  return _postgrestReachable;
}

// =============================================================================
// Direct PostgreSQL Reachability
// =============================================================================

/**
 * Probe for a USABLE PostgreSQL — used by tests that need meta-queries
 * (pg_proc, information_schema) which PostgREST does not expose.
 *
 * Two phases:
 *   1. pg_isready — fast TCP/handshake check (is anything listening at all?)
 *   2. authenticated `SELECT 1` via psql with the configured credentials.
 *
 * Phase 2 matters: a local-warmup / cold-start / e2e stack typically occupies
 * the default port (54322, container aisha-local__aisha-db) with a GENERATED
 * scram password. TCP-only probing classified that DB as "available" and the
 * whole src/tests/db suite then ERRORED on auth instead of skipping (40
 * failures in test:repo:fast). Auth-checking restores the documented
 * contract: run for real when a usable DB is configured (npm run test:db →
 * throwaway DB via AISHA_DB_*), skip gracefully otherwise.
 *
 * Uses execFileSync with an argument array (no shell interpolation) to
 * avoid command-injection risk if env vars are tainted.
 *
 * Synchronous because vitest's `skipIf` is evaluated at describe-time.
 */
let _pgReachable: boolean | null = null;

/** Spuštění sondy: vyhodí výjimku, když příkaz selže nebo vyprší. */
export type SpustSondu = (prikaz: string, argumenty: string[], strop: number) => void;

const spustSondu: SpustSondu = (prikaz, argumenty, strop) => {
  execFileSync(prikaz, argumenty, {
    stdio: "pipe",
    timeout: strop,
    env: { ...process.env, PGPASSWORD: PG_PASSWORD },
  });
};

/** Synchronní pauza (skipIf se vyhodnocuje synchronně při sběru). */
const pauza = (ms: number): void => {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/**
 * Sonda Postgresu. Běžně jeden pokus se stropem 3 s / 5 s a „nedostupná" = false
 * (testy se přeskočí). Povinně víc pokusů s delším stropem a neúspěch = výjimka
 * se značkou ZNACKA_DB_NEDOSTUPNA (soubor se nenačte → rohatka: NEZMĚŘENO).
 */
export function sondaPg(volby: {
  povinna: boolean;
  spust?: SpustSondu;
  pokusy?: number;
  pauzaMs?: number;
}): boolean {
  const spust = volby.spust ?? spustSondu;
  const pokusy = volby.povinna ? (volby.pokusy ?? 3) : 1;
  const pauzaMs = volby.povinna ? (volby.pauzaMs ?? 2000) : 0;
  const [stropReady, stropSql] = volby.povinna ? [10_000, 15_000] : [3000, 5000];
  let posledni = "";
  for (let i = 1; i <= pokusy; i++) {
    try {
      spust("pg_isready", ["-h", PG_HOST, "-p", PG_PORT], stropReady);
      spust(
        "psql",
        ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-tAc", "SELECT 1"],
        stropSql,
      );
      return true;
    } catch (e) {
      posledni = e instanceof Error ? e.message.split("\n")[0] : String(e);
      if (i < pokusy) pauza(pauzaMs);
    }
  }
  if (volby.povinna) {
    throw new Error(
      `${ZNACKA_DB_NEDOSTUPNA}: DB je povinná (AISHA_TESTDB_POVINNA=1), ale ${PG_HOST}:${PG_PORT} ` +
        `neodpověděla ani po ${pokusy} pokusech (${posledni}) — soubor NEZMĚŘEN, ne přeskočen.`,
    );
  }
  return false;
}

export function isPgReachable(): boolean {
  if (_pgReachable !== null) return _pgReachable;
  if (SKIP_DB_TESTS) {
    if (DB_POVINNA) {
      throw new Error(
        `${ZNACKA_DB_NEDOSTUPNA}: AISHA_TESTDB_POVINNA=1 a AISHA_SKIP_DB_TESTS=1 se vylučují — nejde měřit a zároveň přeskočit.`,
      );
    }
    return (_pgReachable = false);
  }
  return (_pgReachable = sondaPg({ povinna: DB_POVINNA }));
}

// =============================================================================
// MLX (Apple Silicon AI) Availability
// =============================================================================

const MLX_VENV_PYTHON = path.join(WORKSPACE_ROOT, "scripts/ai/.venv/bin/python3");
const MLX_VALIDATE_SCRIPT = path.join(WORKSPACE_ROOT, "scripts/ai/validate.py");

export function isAppleSilicon(): boolean {
  try {
    return execFileSync("uname", ["-m"], { encoding: "utf-8" }).trim() === "arm64";
  } catch {
    return false;
  }
}

let _mlxReady: { available: boolean; reason: string } | null = null;

export function checkMlxAvailable(): { available: boolean; reason: string } {
  if (_mlxReady !== null) return _mlxReady;
  if (SKIP_AI_TESTS) {
    return (_mlxReady = { available: false, reason: "Suppressed via AISHA_SKIP_AI_TESTS=1" });
  }
  if (!isAppleSilicon()) {
    return (_mlxReady = { available: false, reason: "Not Apple Silicon (M1/M2/M3/M4)" });
  }
  if (!fs.existsSync(MLX_VENV_PYTHON) || !fs.existsSync(MLX_VALIDATE_SCRIPT)) {
    return (_mlxReady = { available: false, reason: "MLX venv not setup (./scripts/ai/setup-mlx.sh)" });
  }
  try {
    execFileSync(MLX_VENV_PYTHON, ["-c", "import mlx; import mlx_lm"], {
      stdio: "pipe",
      timeout: 30000,
    });
    return (_mlxReady = { available: true, reason: "Ready (Apple MLX)" });
  } catch {
    return (_mlxReady = { available: false, reason: "MLX packages not installed in venv" });
  }
}

// =============================================================================
// Diagnostic Reporter
// =============================================================================

/**
 * Single-line capability summary for beforeAll() hooks.
 * Logs once per test file at startup.
 */
export async function reportTestCapabilities(prefix: string): Promise<void> {
  const pgr = await isPostgrestReachable();
  const pg = isPgReachable();
  const mlx = checkMlxAvailable();

  const parts = [
    `PostgREST=${pgr ? "✓" : "✗"} (${POSTGREST_URL})`,
    `pg=${pg ? "✓" : "✗"} (${PG_HOST}:${PG_PORT})`,
    `MLX=${mlx.available ? "✓" : "✗"} (${mlx.reason})`,
  ];

  if (SKIP_DB_TESTS) parts.push("DB_SKIP=1");
  if (SKIP_AI_TESTS) parts.push("AI_SKIP=1");

  console.log(`ℹ️  ${prefix} capabilities: ${parts.join(" | ")}`);
}
