/**
 * Gate: the WP-1.3 `pgbouncer` transaction-mode pooler is REMOVED (2026-07-06).
 *
 * It was deployed but NEVER adopted — no service ever set PG_HOST=pgbouncer, so it
 * pooled zero traffic while failing its auth_query ("permission denied for table
 * pg_authid": DB_USER=authenticator is not a superuser and there was no SECURITY
 * DEFINER get_auth wrapper) and carrying the whole transaction-mode fragility surface.
 * Every service runs its own pool straight to `db`.
 *
 * This gate locks the removal so the half-wired service can't silently reappear. If a
 * real connection-consolidation need arises, it must come back as a COMPLETE unit
 * (SECURITY DEFINER pgbouncer.get_auth in the DB SoT + AUTH_QUERY/AUTH_USER + apps
 * actually switched to PG_HOST=pgbouncer) — at which point THIS gate is rewritten to
 * assert that complete wiring, not a bare service block.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const COMPOSE = path.join(ROOT, 'docker-compose.coolify.yml');
const IMAGE_VERSIONS = path.join(ROOT, 'config/image-versions.env');

const COMPOSE_FILES = fs
  .readdirSync(ROOT)
  .filter((f) => /^docker-compose.*\.ya?ml$/.test(f));

describe('WP-1.3 pgbouncer — removed (unused pooler)', () => {
  it('no `pgbouncer:` service block in the core compose', () => {
    const compose = fs.readFileSync(COMPOSE, 'utf8');
    expect(compose).not.toMatch(/^\s{2}pgbouncer:\s*$/m);
    expect(compose, 'no aisha-pgbouncer container').not.toMatch(/container_name:\s*aisha-pgbouncer/);
  });

  it('no IMAGE_PGBOUNCER pin in image-versions.env', () => {
    const iv = fs.readFileSync(IMAGE_VERSIONS, 'utf8');
    expect(iv).not.toMatch(/^IMAGE_PGBOUNCER=/m);
  });

  it('no service is wired to route through pgbouncer (PG_HOST=pgbouncer / :6432)', () => {
    // A dangling PG_HOST=pgbouncer or a :6432 upstream would point at a service that
    // no longer exists — an outage waiting to happen. Comments are allowed to mention
    // the removal; actual env assignments / upstreams are not.
    for (const f of COMPOSE_FILES) {
      const body = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const offenders = body
        .split('\n')
        .filter((l) => !/^\s*#/.test(l)) // ignore comment lines
        .filter((l) => /PG_HOST:\s*pgbouncer|PGHOST:\s*pgbouncer|@pgbouncer\b|pgbouncer:6432/.test(l));
      expect(offenders, `${f} still routes to the removed pgbouncer:\n${offenders.join('\n')}`).toEqual([]);
    }
  });

  it('the removal is documented in the notes for the compose it was removed from', () => {
    // The note moved out of the YAML with every other explanation: Coolify ships
    // the compose as a command-line argument and it competes with ARG_MAX, so the
    // file carries configuration only (scripts/compose-extract-notes.mjs). The
    // requirement is unchanged — the removal must stay explained where a reader
    // of this stack will find it.
    const notes = fs.readFileSync(
      path.join(ROOT, 'docs/compose-notes/docker-compose.coolify.yml.md'),
      'utf8',
    );
    expect(notes).toMatch(/pgbouncer.*REMOVED|REMOVED.*pgbouncer/i);
  });
});
