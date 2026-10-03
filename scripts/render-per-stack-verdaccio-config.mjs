#!/usr/bin/env node
/**
 * scripts/render-per-stack-verdaccio-config.mjs
 *
 * Renders config/verdaccio/per-stack-uplink.yaml.tpl into an operator-specified
 * output path, substituting environment variables. Runs at cold-start time on
 * an operator instance so the local Verdaccio can pull @aisha/* from the
 * AISHA hub registry via Verdaccio's native uplink pattern.
 *
 * Why we render at cold-start rather than commit the resolved file:
 *   - AISHA_HUB_VERDACCIO_TOKEN must NOT live in git (per feedback_no_infra_in_repo)
 *   - Per-stack paths differ (host filesystem layout varies per operator)
 *   - Listen port may differ if Verdaccio is colocated with another HTTP service
 *
 * Usage:
 *   node scripts/render-per-stack-verdaccio-config.mjs --out /etc/verdaccio/config.yaml
 *   node scripts/render-per-stack-verdaccio-config.mjs --out /tmp/v.yaml --dry-run
 *
 * Environment (all required unless flagged optional):
 *   AISHA_HUB_VERDACCIO_TOKEN   read-scope token for the AISHA hub registry (required)
 *   VERDACCIO_STORAGE_PATH      optional, default /verdaccio/storage/data
 *   VERDACCIO_HTPASSWD_PATH     optional, default /verdaccio/storage/htpasswd
 *   VERDACCIO_LISTEN_PORT       optional, default 4873
 *
 * Exit codes:
 *   0   rendered successfully
 *   1   render failed (e.g. missing token, template missing)
 *   2   misconfiguration (no --out)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

const args = process.argv.slice(2);
const opts = {
  out: getArg('--out'),
  dryRun: args.includes('--dry-run'),
  quiet: args.includes('--quiet'),
};

function getArg(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

if (args.includes('--help') || args.includes('-h') || !opts.out) {
  console.error(
    'Usage: node scripts/render-per-stack-verdaccio-config.mjs --out <path> [--dry-run] [--quiet]',
  );
  console.error('');
  console.error('  --out       output path (e.g. /etc/verdaccio/config.yaml) — required');
  console.error('  --dry-run   render to stdout instead of writing to --out');
  console.error('');
  console.error('Env vars:');
  console.error('  AISHA_HUB_VERDACCIO_TOKEN  read-scope token for the AISHA hub registry (required)');
  console.error('  VERDACCIO_STORAGE_PATH     default /verdaccio/storage/data');
  console.error('  VERDACCIO_HTPASSWD_PATH    default /verdaccio/storage/htpasswd');
  console.error('  VERDACCIO_LISTEN_PORT      default 4873');
  process.exit(opts.out ? 0 : 2);
}

const TOKEN = process.env.AISHA_HUB_VERDACCIO_TOKEN ?? '';
if (!TOKEN) {
  console.error(
    `${RED}✗${NC} AISHA_HUB_VERDACCIO_TOKEN not set — cannot render uplink config. Operator must provision this from the hub admin.`,
  );
  process.exit(1);
}

const TPL = resolve(
  new URL('.', import.meta.url).pathname,
  '..',
  'config',
  'verdaccio',
  'per-stack-uplink.yaml.tpl',
);

if (!existsSync(TPL)) {
  console.error(`${RED}✗${NC} template missing: ${TPL}`);
  process.exit(1);
}

// Hub registry URL — env-driven (no hardcoded host). VERDACCIO_URL is the
// repo-wide canonical name; AISHA_HUB_VERDACCIO_URL is an explicit override
// for the cross-stack uplink target if it differs from the local registry.
const HUB_URL = (process.env.AISHA_HUB_VERDACCIO_URL ?? process.env.VERDACCIO_URL ?? '').replace(/\/$/, '');
if (!HUB_URL) {
  console.error(
    `${RED}✗${NC} AISHA_HUB_VERDACCIO_URL / VERDACCIO_URL not set — cannot render uplink config (no hardcoded host).`,
  );
  process.exit(1);
}

const replacements = {
  '{{AISHA_HUB_VERDACCIO_URL}}': HUB_URL + '/',
  '{{AISHA_HUB_VERDACCIO_TOKEN}}': TOKEN,
  '{{STORAGE_PATH}}': process.env.VERDACCIO_STORAGE_PATH ?? '/verdaccio/storage/data',
  '{{HTPASSWD_PATH}}': process.env.VERDACCIO_HTPASSWD_PATH ?? '/verdaccio/storage/htpasswd',
  '{{LISTEN_PORT}}': process.env.VERDACCIO_LISTEN_PORT ?? '4873',
};

let rendered = readFileSync(TPL, 'utf-8');
for (const [token, value] of Object.entries(replacements)) {
  // Defensive: ensure rendered token contains no shell metacharacters that
  // might break the YAML parser (port should be numeric, paths absolute).
  if (token === '{{LISTEN_PORT}}' && !/^\d+$/.test(value)) {
    console.error(`${RED}✗${NC} VERDACCIO_LISTEN_PORT must be numeric, got: ${value}`);
    process.exit(1);
  }
  rendered = rendered.split(token).join(value);
}

if (rendered.includes('{{')) {
  // Unresolved placeholders → template/env mismatch
  const remaining = rendered.match(/\{\{[^}]+\}\}/g) ?? [];
  console.error(`${RED}✗${NC} unresolved placeholders: ${remaining.join(', ')}`);
  process.exit(1);
}

if (opts.dryRun) {
  console.log(rendered);
  if (!opts.quiet) console.error(`${YELLOW}∅${NC} dry-run — wrote to stdout, did not touch ${opts.out}`);
  process.exit(0);
}

mkdirSync(dirname(opts.out), { recursive: true });
writeFileSync(opts.out, rendered, { mode: 0o600 });

if (!opts.quiet) {
  console.error(
    `${GREEN}✓${NC} wrote ${rendered.split('\n').length} lines to ${opts.out} ${DIM}(mode 0600)${NC}`,
  );
}
process.exit(0);
