#!/usr/bin/env node
// Re-validate the insight patches against the real submodule content and record
// the attestation (aisha/insight-patches/.insight-validated.json). Run this on a
// FULL clone (packages/insight checked out) whenever you bump the submodule pin
// or edit any aisha/insight-patches/*.patch — otherwise the insight-patches gate
// fails (it refuses to skip the patch-apply check for a changed-insight state).
//
//   git submodule update --init --recursive   # if not already
//   npm run insight:revalidate
//   git add packages/insight aisha/insight-patches/

import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { currentInsightState, baselinePath, haveInsightContent } from './lib/insight-validation.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!haveInsightContent(ROOT)) {
  console.error('FAIL: packages/insight is not checked out. Run `git submodule update --init --recursive` first — revalidation needs the real content.');
  process.exit(1);
}

// The actual validation: every patch must apply cleanly against the pinned content.
try {
  execFileSync('bash', [join(ROOT, 'scripts/insight-patches-apply.sh'), '--check'], { cwd: ROOT, stdio: 'inherit' });
} catch {
  console.error('FAIL: insight patches do NOT apply cleanly against the pinned commit — fix the patches before recording an attestation.');
  process.exit(1);
}

const state = currentInsightState(ROOT);
const payload = {
  _comment: 'Attestation that the insight patches were validated to apply cleanly against this (pin, patches) state on a full checkout. The insight-patches gate REQUIRES content (fails if the submodule is absent) whenever current state differs from this. Refresh with `npm run insight:revalidate` after any submodule bump or patch edit.',
  pin: state.pin,
  patches_sha256: state.patches_sha256,
  validated_at: new Date().toISOString(),
};
writeFileSync(baselinePath(ROOT), JSON.stringify(payload, null, 2) + '\n');
console.log(`OK insight validated — attestation written (pin ${state.pin.slice(0, 12)}, patches ${state.patches_sha256.slice(0, 12)}). Commit aisha/insight-patches/.insight-validated.json`);
