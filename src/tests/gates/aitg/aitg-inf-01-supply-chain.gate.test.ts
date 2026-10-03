/**
 * AITG-INF-01 — supply chain integrity. Three invariants:
 *   1. AI-related packages have sha512 integrity hashes in package-lock.
 *   2. No Dockerfile uses `:latest` (must pin to a tag or digest).
 *   3. No `resolved` URL outside the npm registry or our Verdaccio mirror.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();

describe('AITG-INF-01: supply chain integrity', () => {
  const lockPath = resolve(ROOT, 'package-lock.json');

  test('positive: package-lock.json exists', () => {
    expect(existsSync(lockPath)).toBe(true);
  });

  test('positive: AI provider packages have sha512 integrity', () => {
    if (!existsSync(lockPath)) return;
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
      packages?: Record<string, { integrity?: string }>;
    };
    const aiPkgs = ['openai', '@anthropic-ai/sdk', '@google/generative-ai'];
    for (const pkg of aiPkgs) {
      const entry = lock.packages?.[`node_modules/${pkg}`];
      if (entry?.integrity) {
        expect(entry.integrity, `${pkg} integrity should be sha512-`).toMatch(/^sha512-/);
      }
    }
  });

  test('negative: no Dockerfile uses :latest tag', () => {
    const dockerfiles = readdirSync(ROOT)
      .filter((f) => f.startsWith('Dockerfile'))
      .map((f) => join(ROOT, f));
    const offenders: string[] = [];
    for (const df of dockerfiles) {
      const c = readFileSync(df, 'utf8');
      for (const m of c.matchAll(/^\s*FROM\s+(\S+)/gm)) {
        const ref = m[1];
        if (ref.endsWith(':latest')) offenders.push(`${df}: ${ref}`);
      }
    }
    expect(
      offenders,
      [
        `${offenders.length} Dockerfile FROM line(s) use the floating \`:latest\` tag.`,
        `WHY IT FAILS: \`:latest\` is mutable — builds are non-reproducible and a base-image`,
        `repush can silently change what ships. Pin to an immutable reference.`,
        `HOW TO FIX: replace \`image:latest\` with a version tag or, best, a digest:`,
        `  FROM node:22-bookworm-slim            # explicit tag, OR`,
        `  FROM node:22-bookworm-slim@sha256:<digest>   # fully pinned (preferred)`,
        `Offenders:`,
        ...offenders.map((o) => `  - ${o}`),
      ].join('\n'),
    ).toEqual([]);
  });

  test('negative: no resolved URL outside npmjs.org / aisha Verdaccio', () => {
    if (!existsSync(lockPath)) return;
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
      packages?: Record<string, { resolved?: string }>;
    };
    // The ONLY registries we permit (allow-list). The internal Verdaccio mirror
    // proxies npmjs.org and hosts the @aisha/@evymo scopes. The legacy evymo.com
    // registries (sinopia.evymo.com, npm.evymo.com) and the unused npm.aisha.guru
    // alias were retired in the id3a.cz migration — they must never reappear in a
    // resolved URL, so they are NOT on the allow-list (this gate forbids them).
    const allowedPrefixes = [
      'https://registry.npmjs.org/',
      'https://npm.id3a.cz/',
    ];
    const offenders: string[] = [];
    for (const [name, entry] of Object.entries(lock.packages ?? {})) {
      // Skip npm workspace symlinks — `link: true` entries have a local
      // relative path in `resolved` (e.g. "packages/security"), NOT a
      // registry URL. They are in-repo packages, not external supply-chain
      // dependencies, so the registry-origin check is N/A.
      if ((entry as Record<string, unknown>)?.link) continue;
      const url = entry?.resolved;
      if (!url) continue;
      if (!allowedPrefixes.some((p) => url.startsWith(p))) {
        offenders.push(`${name} -> ${url}`);
      }
    }
    const remediation = [
      `package-lock.json has ${offenders.length} resolved URL(s) pointing OUTSIDE the permitted registries.`,
      `Permitted (allow-list): ${allowedPrefixes.join(', ')}`,
      `Legacy registries (sinopia.evymo.com, npm.evymo.com, sinopia.bezd.me, dev.evymo.com, npm.aisha.guru)`,
      `were retired in the id3a.cz migration and must NEVER reappear in a resolved URL.`,
      ``,
      `WHY IT FAILS: a stale resolved URL makes \`npm ci\` fetch tarballs from a decommissioned /`,
      `uncontrolled host — a supply-chain risk and a broken install on CI / Docker.`,
      `Usual cause: a developer's global ~/.npmrc still has \`registry=https://sinopia.evymo.com/\`,`,
      `so an incremental \`npm install\` re-resolved new deps against the legacy host.`,
      ``,
      `HOW TO FIX:`,
      `  1. Point npm at the Verdaccio mirror (inspect ~/.npmrc for a legacy "registry=" line):`,
      `       npm config set registry https://npm.id3a.cz/`,
      `  2. Re-resolve ONLY the lockfile from a clean base (keeps node_modules intact):`,
      `       git checkout origin/main -- package-lock.json`,
      `       npm install --package-lock-only --registry=https://npm.id3a.cz/`,
      `  3. Verify no legacy host remains (expect no matches):`,
      `       grep -nE 'sinopia|npm\\.evymo|dev\\.evymo|npm\\.aisha\\.guru' package-lock.json`,
      ``,
      `Offending entries (first 10):`,
      ...offenders.slice(0, 10).map((o) => `  - ${o}`),
    ].join('\n');
    expect(offenders.slice(0, 10), remediation).toEqual([]);
  });
});
