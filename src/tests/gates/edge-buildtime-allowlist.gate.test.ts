/**
 * Gate test: edge-buildtime-allowlist
 *
 * Locks two invariants of the aisha-edge deploy plumbing discovered on the
 * 2026-06-12 post-wipe wave-2 failure:
 *
 * 1. PARSE-REQUIRED ⊆ BUILDTIME ALLOWLIST — Coolify hands `docker compose
 *    build` ONLY is_buildtime=true env keys (/artifacts/build-time.env), and
 *    the edge compose carries `${VAR:?}` parse-time guards. The web-app
 *    branch of coolify_normalize_buildtime_envs() flags just an allowlist —
 *    every `${VAR:?}` key in docker-compose.coolify-prebuilt.yml (plus the
 *    web build.args' KEYCLOAK_REALM) MUST match coolify_buildtime_key_regex()
 *    or the FIRST deploy of a fresh app dies at compose interpolation:
 *    "required variable X is missing a value". Old apps masked this with
 *    inherited pre-allowlist flags; every --wipe exposes it.
 *
 * 2. VALUE-PRESERVING FLAG FLIPS — Coolify's PATCH /applications/{uuid}/envs
 *    treats a payload WITHOUT `value` as value="" and WIPES the production
 *    row (the preview copy survives). The normalize step must therefore
 *    include the current value in every flag-flip payload, or it destroys
 *    the values the bulk sync just wrote (empty-prod/filled-preview
 *    asymmetry → render-app-config FATAL on the next build).
 *
 * Run via: `npm run test:gates`
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zdrojeSvazku } from './lib/zdroje-svazku';

const ROOT = process.cwd();
const COMPOSE = join(ROOT, 'docker-compose.coolify-prebuilt.yml');
const LIB = join(ROOT, 'scripts/lib/coolify-buildtime-envs.sh');

/**
 * All parse-required keys in the edge compose — `${VAR:?...}` AND `${VAR?...}`.
 *
 * ⛔ 2026-09-15: `${SPA_KNOCK_PUBLIC_PORT?…}` (bez dvojtečky — compose interpoluje
 * i službu za vypnutým profilem, takže prázdno musí projít) je parse-guard
 * TÉŽE třídy: nenastavená proměnná shodí interpolaci stejně. Sken jen `:?` by
 * ho minul a první nasazení čerstvé aplikace by padlo na „required variable".
 */
function parseRequiredKeys(): string[] {
  const compose = readFileSync(COMPOSE, 'utf8');
  const keys = new Set<string>();
  for (const m of compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*):?\?/g)) {
    keys.add(m[1]);
  }
  return [...keys].sort();
}

/** The allowlist regex exactly as the deploy tooling computes it. */
function buildtimeRegex(): RegExp {
  const raw = execFileSync('bash', [
    '-c',
    `source '${LIB}' && coolify_buildtime_key_regex`,
  ]).toString();
  expect(raw, 'coolify_buildtime_key_regex must print a regex').toMatch(/^\^/);
  return new RegExp(raw);
}

/**
 * Env keys interpolated inside `extra_hosts` list entries of the edge compose.
 *
 * These are parse-required WITHOUT carrying a `${VAR:?}` guard: Coolify's
 * build step parses the compose with build-time.env only, and an entry whose
 * hostname side interpolates to "" degenerates to ":<ip>" — a hard compose
 * schema error (`extra_hosts must be a mapping`), not a warning. This is the
 * class the original `${VAR:?}`-only sweep missed: every aisha-edge deploy
 * failed validation from 2026-07-07 (extra_hosts introduction) until
 * 2026-07-09 while the app silently kept running a stale container.
 */
function extraHostsEnvKeys(): string[] {
  const compose = readFileSync(COMPOSE, 'utf8');
  const keys = new Set<string>();
  let inExtraHosts = false;
  for (const line of compose.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('extra_hosts:')) {
      inExtraHosts = true;
      continue;
    }
    if (inExtraHosts) {
      if (!trimmed.startsWith('-')) {
        inExtraHosts = false;
        continue;
      }
      for (const m of trimmed.matchAll(/\$\{([A-Z_][A-Z0-9_]*)(?::-[^}]*)?\}/g)) {
        keys.add(m[1]);
      }
    }
  }
  return [...keys].sort();
}

/**
 * Proměnné interpolované ve ZDROJI svazku edge compose (krátký i dlouhý tvar).
 *
 * Třída téže díry jako `extra_hosts`: zdroj svazku se dosazuje při parsování,
 * `:?` stráž nemusí mít (stráž může stát jinde — nebo chybět). Runtime-only klíč
 * se při build-parse Coolify dosadí prázdný a položka `:/cíl` compose shodí.
 */
function volumeSourceEnvKeys(): string[] {
  const keys = new Set<string>();
  for (const z of zdrojeSvazku(COMPOSE, readFileSync(COMPOSE, 'utf8'))) {
    for (const m of z.zdroj.matchAll(/\$\{([A-Z_][A-Z0-9_]*)/g)) keys.add(m[1]);
  }
  return [...keys].sort();
}

describe('edge-buildtime-allowlist — fresh-app deploys must survive compose interpolation', () => {
  it('sanity: the edge compose declares parse-required keys', () => {
    const keys = parseRequiredKeys();
    // The route contract alone is 13 keys; if this collapses the gate rotted.
    expect(keys.length).toBeGreaterThanOrEqual(10);
  });

  it('extra_hosts interpolated keys match the buildtime allowlist (empty hostname = hard parse error)', () => {
    const keys = extraHostsEnvKeys();
    // The mesh-router extra_hosts block carries at least the NetBird pair;
    // if this collapses the extractor (or the compose) rotted.
    expect(keys.length).toBeGreaterThanOrEqual(2);
    const re = buildtimeRegex();
    const uncovered = keys.filter((k) => !re.test(k));
    expect(
      uncovered,
      [
        'These env keys are interpolated inside edge-compose `extra_hosts` entries',
        'but are NOT covered by coolify_buildtime_key_regex(). Coolify validates',
        'the compose with build-time.env only — a runtime-only key interpolates',
        'to "" and the entry degenerates to ":<ip>", a hard schema error',
        '(`extra_hosts must be a mapping`) that fails EVERY aisha-edge deploy',
        '(incident 2026-07-09). Extend the allowlist in',
        'scripts/lib/coolify-buildtime-envs.sh:',
        ...uncovered.map((k) => `  - ${k}`),
      ].join('\n'),
    ).toEqual([]);
  });

  it('volume-source interpolated keys match the buildtime allowlist (empty source = hard parse error)', () => {
    const keys = volumeSourceEnvKeys();
    // Edge web montuje výstup rendereru a skořápku z hostitelských cest instance;
    // zmizí-li obě, extraktor (nebo compose) shnil — měřidlo nesmí zezelenat naprázdno.
    expect(keys.length).toBeGreaterThanOrEqual(2);
    const re = buildtimeRegex();
    const uncovered = keys.filter((k) => !re.test(k));
    expect(
      uncovered,
      [
        'These env keys are interpolated in an edge-compose volume SOURCE but are',
        'NOT covered by coolify_buildtime_key_regex(). Coolify parses the compose',
        'with build-time.env only — a runtime-only key yields an empty source and',
        'the fresh-app deploy dies before anything is built. Extend the allowlist in',
        'scripts/lib/coolify-buildtime-envs.sh:',
        ...uncovered.map((k) => `  - ${k}`),
      ].join('\n'),
    ).toEqual([]);
  });

  it('every ${VAR:?} key (+ web build.args realm) matches the buildtime allowlist', () => {
    const re = buildtimeRegex();
    const required = [...parseRequiredKeys(), 'KEYCLOAK_REALM'];
    const uncovered = required.filter((k) => !re.test(k));
    expect(
      uncovered,
      [
        'These edge-compose parse-required env keys are NOT covered by',
        'coolify_buildtime_key_regex() — the first deploy of a fresh aisha-edge',
        '(every --wipe) will fail compose interpolation with',
        '"required variable X is missing a value". Extend the web-app allowlist',
        'in scripts/lib/coolify-buildtime-envs.sh:',
        ...uncovered.map((k) => `  - ${k}`),
      ].join('\n'),
    ).toEqual([]);
  });

  it('the allowlist stays anchored — secrets must NOT leak into build-time env', () => {
    const re = buildtimeRegex();
    for (const secret of [
      'POSTGRES_PASSWORD',
      'JWT_SECRET',
      'SERVICE_ROLE_KEY',
      'ANON_KEY',
      'KEYCLOAK_ADMIN_PASSWORD',
      'OAUTH_GOOGLE_CLIENT_SECRET',
      'MCP_DOMAINS', // near-miss: anchored $ must reject suffixed variants
      'DIRIGENT_DOMAIN_X',
    ]) {
      expect(re.test(secret), `${secret} must NOT match the buildtime allowlist`).toBe(false);
    }
  });

  it('normalize flag-flips carry the current value (Coolify wipes value-less PATCHes)', () => {
    const lib = readFileSync(LIB, 'utf8');
    const updatesBlock = lib.slice(lib.indexOf('updates=$('), lib.indexOf("if [ -z \"$updates\" ]"));
    expect(
      updatesBlock,
      'the normalize jq payload must include `value: ($env.value // "")` — ' +
        'a meta-only PATCH empties the production env row',
    ).toContain('value: ($env.value // "")');
  });
});
