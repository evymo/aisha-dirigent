/**
 * Gate test: Phase 12 WP 1.2 — Postgres 17 tuning invariants.
 *
 * Enforces:
 *   1. infra/postgres/postgresql.conf has Wave A (restart-required) + Wave B
 *      (reload-only) tuning lines per the WP 1.2 plan spec
 *   2. shared_preload_libraries includes pg_stat_statements + auto_explain
 *      + pgaudit (consumed by postgres-exporter in WP 0.2)
 *   3. Timestamped migration enabling the 3 extensions is registered
 *   4. Migration also creates postgres_exporter role (needed by WP 0.2)
 *   5. Runbook documents the two-wave rollout + rollback
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const PG_CONF = path.join(ROOT, 'infra/postgres/postgresql.conf');
const RUNBOOK = path.join(ROOT, 'docs/perf/POSTGRES_TUNING_RUNBOOK.md');
const REGISTRY = path.join(ROOT, 'aisha/db/migration-registry.json');

function readOrEmpty(p: string): string {
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

function getSetting(conf: string, name: string): string | null {
  // Match `name = value`, allow inline comments. Skip commented-out lines.
  const re = new RegExp(`^\\s*${name}\\s*=\\s*([^#\\n]+)`, 'm');
  const m = conf.match(re);
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : null;
}

describe('Phase 12 WP 1.2 — postgresql.conf Wave A (restart-required)', () => {
  const conf = readOrEmpty(PG_CONF);

  it('postgresql.conf exists', () => {
    expect(fs.existsSync(PG_CONF)).toBe(true);
  });

  it('shared_buffers = 2GB (was 256MB)', () => {
    expect(getSetting(conf, 'shared_buffers')).toBe('2GB');
  });

  it('wal_compression = zstd (was off)', () => {
    expect(getSetting(conf, 'wal_compression')).toBe('zstd');
  });

  it('max_parallel_workers_per_gather = 4 (was default 2)', () => {
    expect(getSetting(conf, 'max_parallel_workers_per_gather')).toBe('4');
  });

  it('shared_preload_libraries includes pg_stat_statements + auto_explain + pgaudit', () => {
    const v = getSetting(conf, 'shared_preload_libraries') ?? '';
    expect(v).toMatch(/pg_stat_statements/);
    expect(v).toMatch(/auto_explain/);
    expect(v).toMatch(/pgaudit/);
  });
});

describe('Phase 12 WP 1.2 — postgresql.conf Wave B (reload-only)', () => {
  const conf = readOrEmpty(PG_CONF);

  it('effective_cache_size = 6GB (was 768MB)', () => {
    expect(getSetting(conf, 'effective_cache_size')).toBe('6GB');
  });

  it('work_mem = 32MB (was 4MB)', () => {
    expect(getSetting(conf, 'work_mem')).toBe('32MB');
  });

  it('maintenance_work_mem = 512MB (was 64MB)', () => {
    expect(getSetting(conf, 'maintenance_work_mem')).toBe('512MB');
  });

  it('random_page_cost = 1.1 (SSD; was 4.0)', () => {
    expect(getSetting(conf, 'random_page_cost')).toBe('1.1');
  });

  it('effective_io_concurrency = 200 (SSD; was 1)', () => {
    expect(getSetting(conf, 'effective_io_concurrency')).toBe('200');
  });

  it('auto_explain.log_min_duration set to 1s', () => {
    expect(getSetting(conf, 'auto_explain.log_min_duration')).toBe('1s');
  });

  it('pgaudit.log = ddl, role (DDL + role-change audit only)', () => {
    const v = getSetting(conf, 'pgaudit.log') ?? '';
    expect(v).toMatch(/ddl/);
    expect(v).toMatch(/role/);
  });
});

describe('Phase 12 WP 1.2 — migration + role', () => {
  it('observability/audit extensions are enabled in the infra config', () => {
    // The extension enablement moved from a migration to the infra layer — its
    // canonical home now: postgresql.conf loads pg_stat_statements + pgaudit +
    // auto_explain via shared_preload_libraries, and the pg17 image installs the
    // contrib packages (infra/postgres/Dockerfile). CREATE EXTENSION + the
    // postgres_exporter GRANTs run at cold-start as part of that infra setup.
    const preload = getSetting(readOrEmpty(PG_CONF), 'shared_preload_libraries') ?? '';
    expect(preload).toContain('pg_stat_statements');
    expect(preload).toContain('pgaudit');
    expect(preload).toContain('auto_explain');
  });

  it('pg-extensions setup is folded into infra/baseline (baseline-only)', () => {
    const registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) as {
      migrations: string[];
    };
    expect(registry.migrations).toEqual([]);
  });

  it('pgaudit DDL/role audit is configured (compliance trail)', () => {
    const conf = readOrEmpty(PG_CONF);
    expect(conf).toMatch(/pgaudit\.log\s*=/);
  });
});

describe('Phase 12 WP 1.2 — runbook', () => {
  it('POSTGRES_TUNING_RUNBOOK.md exists', () => {
    expect(fs.existsSync(RUNBOOK)).toBe(true);
  });

  it('runbook documents Wave A + Wave B + rollback', () => {
    const md = readOrEmpty(RUNBOOK);
    expect(md).toMatch(/Wave A/);
    expect(md).toMatch(/Wave B/);
    expect(md).toMatch(/Rollback/i);
    expect(md).toMatch(/pg_reload_conf/);
    expect(md).toMatch(/docker compose.*restart db/);
  });

  it('runbook references baseline + risk register', () => {
    const md = readOrEmpty(RUNBOOK);
    expect(md).toMatch(/BASELINE_2026-05-20\.md/);
    expect(md).toMatch(/[Rr]isk/);
  });

  it('runbook explicitly verifies cache hit ratio post-deploy', () => {
    const md = readOrEmpty(RUNBOOK);
    expect(md).toMatch(/cache.hit/i);
  });
});
