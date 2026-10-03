/**
 * Cross-stack Verdaccio uplink gate.
 *
 * Pairs with `config/verdaccio/per-stack-uplink.yaml.tpl`,
 * `scripts/render-per-stack-verdaccio-config.mjs`, and
 * `docs/release/CROSS_STACK_VERDACCIO_MIRROR.md`. Closes task D of the
 * post-#100/#105 plan — per-stack operator instances pull @aisha/* from the
 * hub via Verdaccio's native uplink pattern.
 *
 * Why this gate: without it, a future PR could:
 *  - delete the template → operators can't set up cross-stack mirror
 *  - flip the uplink URL to a typo/wrong domain → silent fan-out failure
 *  - drop the bearer auth → token leaks in URL or no auth
 *  - rename the renderer → cold-start chain breaks
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const TEMPLATE = resolve(ROOT, 'config/verdaccio/per-stack-uplink.yaml.tpl');
const RENDERER = resolve(ROOT, 'scripts/render-per-stack-verdaccio-config.mjs');
const RUNBOOK = resolve(ROOT, 'docs/release/CROSS_STACK_VERDACCIO_MIRROR.md');

describe('Cross-stack Verdaccio uplink — template', () => {
  test('template exists at canonical path', () => {
    expect(existsSync(TEMPLATE), 'config/verdaccio/per-stack-uplink.yaml.tpl missing').toBe(true);
  });

  test('template declares hub uplink via env placeholder (no hardcoded host) + bearer auth (not URL creds)', () => {
    const tpl = readFileSync(TEMPLATE, 'utf-8');
    // Host is env-driven: rendered from {{AISHA_HUB_VERDACCIO_URL}}, never a
    // literal registry host (2026-06-10 de-hardcoding).
    expect(tpl, 'hub url must be the {{AISHA_HUB_VERDACCIO_URL}} placeholder').toMatch(
      /url:\s*\{\{AISHA_HUB_VERDACCIO_URL\}\}/,
    );
    expect(tpl, 'no hardcoded internal registry host in the template').not.toMatch(/npm\.id3a\.cz/);
    expect(tpl, 'bearer auth — token not in URL').toMatch(/auth:[\s\S]{0,80}type:\s*bearer/);
    expect(tpl, 'no URL-embedded credentials (token@host pattern)').not.toMatch(/https:\/\/[^/]*:[^/]*@/);
  });

  test('template proxies @aisha/* through aisha-hub uplink', () => {
    const tpl = readFileSync(TEMPLATE, 'utf-8');
    // Find the @aisha/* package block and assert proxy is set
    expect(tpl).toMatch(/'@aisha\/\*':[\s\S]{0,200}proxy:\s*aisha-hub/);
  });

  test('template disables local publish for @aisha/* (hub is source of truth)', () => {
    const tpl = readFileSync(TEMPLATE, 'utf-8');
    // The publish: $admin pattern ensures operators can't accidentally
    // diverge from the hub by publishing locally.
    expect(tpl).toMatch(/'@aisha\/\*':[\s\S]{0,200}publish:\s*\$admin/);
  });

  test('template binds 0.0.0.0 so Coolify Traefik can route to it', () => {
    const tpl = readFileSync(TEMPLATE, 'utf-8');
    expect(tpl).toMatch(/0\.0\.0\.0:\{\{LISTEN_PORT\}\}/);
  });

  test('template has all 4 required placeholder tokens', () => {
    const tpl = readFileSync(TEMPLATE, 'utf-8');
    expect(tpl).toMatch(/\{\{AISHA_HUB_VERDACCIO_TOKEN\}\}/);
    expect(tpl).toMatch(/\{\{STORAGE_PATH\}\}/);
    expect(tpl).toMatch(/\{\{HTPASSWD_PATH\}\}/);
    expect(tpl).toMatch(/\{\{LISTEN_PORT\}\}/);
  });

  test('template does NOT contain a literal token (no committed creds)', () => {
    const tpl = readFileSync(TEMPLATE, 'utf-8');
    // Heuristic: token-shaped strings are JWT (eyJ...) or bearer hex tokens.
    expect(tpl, 'no JWT-like string committed').not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
    // No literal "Bearer <hex>" outside the placeholder
    expect(tpl).not.toMatch(/Bearer\s+[A-Fa-f0-9]{20,}/);
  });
});

describe('Cross-stack Verdaccio uplink — renderer', () => {
  test('renderer exists at canonical path', () => {
    expect(existsSync(RENDERER), 'scripts/render-per-stack-verdaccio-config.mjs missing').toBe(true);
  });

  test('renderer accepts --out (required) + --dry-run', () => {
    const src = readFileSync(RENDERER, 'utf-8');
    expect(src).toMatch(/--out/);
    expect(src).toMatch(/--dry-run/);
  });

  test('renderer refuses to render without AISHA_HUB_VERDACCIO_TOKEN', () => {
    const src = readFileSync(RENDERER, 'utf-8');
    expect(src).toMatch(/AISHA_HUB_VERDACCIO_TOKEN/);
    expect(src, 'renderer fails fast when token missing').toMatch(
      /if \(!TOKEN\)[\s\S]{0,200}process\.exit\(1\)/,
    );
  });

  test('renderer writes mode 0600 (token-bearing, not world-readable)', () => {
    const src = readFileSync(RENDERER, 'utf-8');
    expect(src).toMatch(/mode:\s*0o600/);
  });

  test('renderer validates VERDACCIO_LISTEN_PORT is numeric', () => {
    const src = readFileSync(RENDERER, 'utf-8');
    expect(src).toMatch(/VERDACCIO_LISTEN_PORT/);
    // The renderer tests the port against /^\d+$/ before substituting it
    // into the YAML — prevents an operator from injecting shell metacharacters
    // via a non-numeric env var value.
    expect(src, 'numeric validation against /^\\d+$/ near LISTEN_PORT').toMatch(/LISTEN_PORT[\s\S]{0,300}\\d\+\$/);
  });

  test('renderer fails fast if template has unresolved placeholders after substitution', () => {
    const src = readFileSync(RENDERER, 'utf-8');
    expect(src).toMatch(/unresolved placeholders/);
  });

  test('renderer is pure stdlib — no shell-form subprocess', () => {
    const raw = readFileSync(RENDERER, 'utf-8');
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
    expect(src, 'no execSync — pure file I/O').not.toMatch(/\bexecSync\s*\(/);
  });
});

describe('Cross-stack Verdaccio uplink — operator runbook', () => {
  test('runbook exists at canonical path', () => {
    expect(existsSync(RUNBOOK), 'docs/release/CROSS_STACK_VERDACCIO_MIRROR.md missing').toBe(true);
  });

  test('runbook references the template + renderer + companion docs', () => {
    const md = readFileSync(RUNBOOK, 'utf-8');
    expect(md).toMatch(/per-stack-uplink\.yaml\.tpl/);
    expect(md).toMatch(/render-per-stack-verdaccio-config\.mjs/);
    expect(md).toMatch(/AISHA_PACKAGES_PUBLISH\.md/);
  });

  test('runbook documents the failure modes', () => {
    const md = readFileSync(RUNBOOK, 'utf-8');
    expect(md).toMatch(/Failure modes/i);
    expect(md, 'documents 401 from invalid token').toMatch(/401|unauthorized/i);
    expect(md, 'documents network partition / hub down').toMatch(/partition|hub down|ETIMEDOUT/);
  });

  test('runbook explains why fan-out from CI was rejected', () => {
    const md = readFileSync(RUNBOOK, 'utf-8');
    expect(md, 'explicit rationale prevents future "let\'s fan-out instead" regression').toMatch(
      /fan-out|native uplink pattern|pull-through/i,
    );
  });

  test('runbook documents the air-gap behavior (cache continues serving)', () => {
    const md = readFileSync(RUNBOOK, 'utf-8');
    expect(md, 'air-gappable deployment is part of the value prop').toMatch(/air-?gap/i);
  });
});
