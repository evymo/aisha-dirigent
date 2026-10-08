#!/usr/bin/env node
/**
 * ACS breaking-change detector (IP-10, R4).
 *
 * Compares packages/acs-contracts/schemas/*.json against the same files on the
 * base ref (default: origin/main, fallback main). Rules:
 *   - removed schema file .............................. BREAKING
 *   - removed required property / added required prop ... BREAKING (same major)
 *   - removed enum value ................................ BREAKING (same major)
 *   - type change of an existing property ............... BREAKING (same major)
 *   - anything breaking requires a MAJOR bump in the file name (name@MAJOR.x)
 *   - additive change (new optional prop, new enum value, new schema) → minor OK
 *
 * Exit 1 on violation. No shell interpolation (execFileSync + arg arrays).
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA_DIR = 'packages/acs-contracts/schemas';
const git = (args) => execFileSync('git', args, { encoding: 'utf8' });
const tryGit = (args) => { try { return git(args); } catch { return null; } };

const baseRef = process.argv[2]
  ?? (tryGit(['rev-parse', '--verify', '--quiet', 'origin/main']) ? 'origin/main'
    : tryGit(['rev-parse', '--verify', '--quiet', 'upstream/main']) ? 'upstream/main'
      : 'main');

const parseRef = (name) => {
  const m = /^(?<base>.+)@(?<major>\d+)\.(?<minor>\d+)\.json$/.exec(name);
  return m ? { base: m.groups.base, major: Number(m.groups.major), minor: Number(m.groups.minor) } : null;
};

const headFiles = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.json'));
const baseList = (tryGit(['ls-tree', '--name-only', baseRef, `${SCHEMA_DIR}/`]) ?? '')
  .split('\n').map((l) => l.split('/').pop()).filter((f) => f && f.endsWith('.json'));

const problems = [];
const walk = (a, b, path, out) => {
  // b = new, a = old
  if (a === undefined) return;
  if (b === undefined) { out.push(`${path}: property removed`); return; }
  const ta = Array.isArray(a) ? 'array' : typeof a;
  const tb = Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) { out.push(`${path}: shape changed (${ta} → ${tb})`); return; }
  if (ta !== 'object' || a === null) return;

  if (Array.isArray(a.required) && Array.isArray(b?.required)) {
    for (const r of a.required) if (!b.required.includes(r)) out.push(`${path}.required: "${r}" removed`);
    for (const r of b.required) if (!a.required.includes(r)) out.push(`${path}.required: "${r}" ADDED (breaks existing producers)`);
  }
  if (Array.isArray(a.enum) && Array.isArray(b?.enum)) {
    for (const v of a.enum) if (!b.enum.includes(v)) out.push(`${path}.enum: value ${JSON.stringify(v)} removed`);
  }
  if (typeof a.type === 'string' && typeof b?.type === 'string' && a.type !== b.type) {
    out.push(`${path}.type: ${a.type} → ${b.type}`);
  }
  if (a.properties && typeof a.properties === 'object') {
    for (const key of Object.keys(a.properties)) {
      walk(a.properties[key], b.properties?.[key], `${path}.${key}`, out);
    }
  }
  if (a.items) walk(a.items, b.items, `${path}[]`, out);
};

for (const baseName of baseList) {
  const ref = parseRef(baseName);
  if (!ref) continue;
  if (!headFiles.includes(baseName)) {
    const successor = headFiles.map(parseRef).find((r) => r && r.base === ref.base && r.major > ref.major);
    if (!successor) problems.push(`${baseName}: schema removed without a major successor`);
    continue;
  }
  const before = JSON.parse(tryGit(['show', `${baseRef}:${SCHEMA_DIR}/${baseName}`]) ?? 'null');
  const after = JSON.parse(readFileSync(join(SCHEMA_DIR, baseName), 'utf8'));
  const found = [];
  walk(before, after, ref.base, found);
  if (found.length > 0) {
    problems.push(`${baseName}: breaking change within the SAME version — bump major instead:\n    ${found.join('\n    ')}`);
  }
}

if (problems.length > 0) {
  console.error('✖ ACS schema-diff: breaking contract changes detected\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nRule (R4): breaking = new major version file + dual-run window. See docs/acs/ACS_ROLLOUT_RUNBOOK.md.');
  process.exit(1);
}
console.log(`✓ ACS schema-diff vs ${baseRef}: no breaking changes (${headFiles.length} contracts)`);
