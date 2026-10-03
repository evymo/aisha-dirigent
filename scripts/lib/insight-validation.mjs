// Shared insight-submodule validation state.
//
// The packages/insight submodule is fetched from the aisha-maintained fork
// (repo.id3a.cz/aisha/insight); restricted environments may still check out the
// parent without submodules, so it can be absent. The "do the patches apply cleanly to the pinned content?" check needs
// the working tree. To keep that protection STRICT without requiring universal
// access, we attest the last-validated state: whenever the pin (gitlink) OR any
// aisha/insight-patches/*.patch differs from the recorded attestation, the patch
// content MUST be re-validated (the gate fails if the submodule is absent). When
// nothing insight-related changed, the earlier attestation still holds, so a
// content-absent environment may legitimately skip the apply check — never the
// changed case. The pin↔patch-header consistency check is content-independent
// and runs always (see insight-patches.gate).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const patchesDir = (root) => join(root, 'aisha/insight-patches');
export const baselinePath = (root) => join(root, 'aisha/insight-patches/.insight-validated.json');

/** Pinned submodule commit, read from the PARENT gitlink (content-independent). */
export function pinnedCommit(root) {
  const out = execFileSync('git', ['ls-tree', 'HEAD', 'packages/insight'], { cwd: root, encoding: 'utf-8' }).trim();
  const m = out.match(/^160000\s+commit\s+([a-f0-9]{40})\s/);
  if (!m) throw new Error(`Could not parse submodule pin from \`git ls-tree HEAD packages/insight\`: ${out}`);
  return m[1];
}

/** Deterministic hash over the patch set (sorted name + content). */
export function patchesHash(root) {
  const dir = patchesDir(root);
  const h = createHash('sha256');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.patch')).sort()) {
      h.update(f); h.update('\0');
      h.update(readFileSync(join(dir, f))); h.update('\0');
    }
  }
  return h.digest('hex');
}

/** Whether the insight submodule content (working tree) is present. */
export function haveInsightContent(root) {
  const sub = join(root, 'packages/insight');
  return existsSync(join(sub, '.git')) || existsSync(join(sub, 'maestro', 'Pipfile'));
}

/** Current (pin, patches) state. */
export function currentInsightState(root) {
  return { pin: pinnedCommit(root), patches_sha256: patchesHash(root) };
}

export function readBaseline(root) {
  const p = baselinePath(root);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

/** True when the current insight state differs from the recorded attestation —
 *  i.e. the patch-apply validation must run against real content (no skipping). */
export function insightNeedsValidation(root) {
  const cur = currentInsightState(root);
  const base = readBaseline(root);
  if (!base) return true; // no attestation yet → must validate
  return base.pin !== cur.pin || base.patches_sha256 !== cur.patches_sha256;
}
