/**
 * DB-03 — Continuous WAL Archiving / PITR Gate (remediation, test-first)
 *
 * CONTRACT:
 *   The Postgres deployment MUST be capable of Point-In-Time-Recovery, which
 *   requires *continuous* WAL archiving (not just periodic logical dumps):
 *
 *     1. infra/postgres/postgresql.conf MUST set, on a non-comment line:
 *          - `archive_mode = on`
 *          - a non-empty `archive_command = '<...>'`
 *     2. docker-compose.coolify.yml MUST declare a dedicated continuous-archive
 *        backup service/sidecar — pgBackRest or WAL-G — that ships the WAL
 *        stream / base backups off the primary.
 *
 * WHY: Coolify scheduled `pg_dump`/logical backups give at-best last-snapshot
 *   recovery (hours of data loss, no PITR). Real recoverability from corruption
 *   or accidental writes needs the archived WAL segments + a base backup so the
 *   cluster can be replayed to an arbitrary point in time.
 *
 * SCOPE NOTE (finding is PARTIAL): a Coolify backup schedule and a separate
 *   backup gate already exist. This gate deliberately targets ONLY the missing
 *   continuous-archiving / PITR half — archive_mode/archive_command in the pg
 *   config AND a pgBackRest/WAL-G service in the compose stack.
 *
 * KNOWN-RED (at authoring, branch feat/remediation): postgresql.conf declares
 *   `wal_level = replica` but NO `archive_mode` and NO `archive_command`, and
 *   NO docker-compose*.yml declares a pgbackrest / wal-g service (0 matches
 *   across the whole tree). Instances flagged: 1 canonical DB deployment
 *   (config file + compose stack). Post-fix: enable archive_mode + a real
 *   archive_command and wire a pgBackRest/WAL-G sidecar → gate GREEN.
 *
 * Runnable: AISHA_SKIP_ONLINE=1 npx vitest run --config vitest.gates.config.ts \
 *   src/tests/gates/remediation/db-wal-archiving.gate.test.ts
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();

const PG_CONF = path.join(ROOT, "infra", "postgres", "postgresql.conf");
const COMPOSE = path.join(ROOT, "docker-compose.coolify.yml");

/**
 * Strip full-line and trailing `#` comments so we only assert against
 * *effective* (uncommented) configuration directives.
 */
function effectiveLines(conf: string): string[] {
  return conf
    .split(/\r?\n/)
    .map((line) => {
      const hash = line.indexOf("#");
      return (hash >= 0 ? line.slice(0, hash) : line).trim();
    })
    .filter((line) => line.length > 0);
}

/**
 * Continuous-archive backup images/services. pgBackRest and WAL-G are the two
 * mainstream tools that ship WAL segments + base backups for PITR. Matching is
 * case-insensitive over the raw compose text (service key or image ref).
 */
const PITR_BACKUP_PATTERNS: readonly RegExp[] = [
  /pgbackrest/i,
  /\bwal-?g\b/i,
];

describe("DB-03 — continuous WAL archiving / PITR is configured", () => {
  it("infra/postgres/postgresql.conf exists", () => {
    expect(fs.existsSync(PG_CONF), `missing ${PG_CONF}`).toBe(true);
  });

  it("postgresql.conf enables archive_mode = on", () => {
    const lines = effectiveLines(fs.readFileSync(PG_CONF, "utf8"));
    const archiveMode = lines.find((l) => /^archive_mode\s*=/i.test(l));
    expect(
      archiveMode,
      "postgresql.conf has no effective `archive_mode` directive — continuous " +
        "WAL archiving is off, so PITR is impossible (only logical dumps exist).",
    ).toBeDefined();
    expect(
      /^archive_mode\s*=\s*(on|always)\b/i.test(archiveMode ?? ""),
      `archive_mode must be 'on' (or 'always'); got: ${archiveMode}`,
    ).toBe(true);
  });

  it("postgresql.conf sets a non-empty archive_command", () => {
    const lines = effectiveLines(fs.readFileSync(PG_CONF, "utf8"));
    const archiveCmd = lines.find((l) => /^archive_command\s*=/i.test(l));
    expect(
      archiveCmd,
      "postgresql.conf has no effective `archive_command` directive — WAL " +
        "segments are never shipped off the primary, so PITR is impossible.",
    ).toBeDefined();
    // Extract the quoted value and require it to be non-empty.
    const match = /^archive_command\s*=\s*'([^']*)'/i.exec(archiveCmd ?? "");
    expect(
      match,
      `archive_command must be a quoted string; got: ${archiveCmd}`,
    ).not.toBeNull();
    expect(
      (match?.[1] ?? "").trim().length,
      "archive_command is empty — no WAL is archived.",
    ).toBeGreaterThan(0);
  });

  it("docker-compose.coolify.yml declares a pgBackRest / WAL-G backup service", () => {
    expect(fs.existsSync(COMPOSE), `missing ${COMPOSE}`).toBe(true);
    const compose = fs.readFileSync(COMPOSE, "utf8");
    const matched = PITR_BACKUP_PATTERNS.filter((re) => re.test(compose));
    expect(
      matched.length,
      "docker-compose.coolify.yml declares no pgBackRest / WAL-G service — " +
        "there is no continuous-archive sidecar shipping WAL/base backups. " +
        "Coolify scheduled dumps are not PITR.",
    ).toBeGreaterThan(0);
  });
});
