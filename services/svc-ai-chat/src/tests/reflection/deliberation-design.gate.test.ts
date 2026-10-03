/**
 * Doc-invariant gate for the deliberation/fusion extension.
 *
 * The design's whole point is EFFICIENCY (default single, never fan out
 * interactively, never overspend) and NON-DUPLICATION of the E0 decision SoT.
 * Those are easy to silently lose in a doc edit. This gate makes them executable
 * — the proposal cannot drop the invariants or the E0 dependency declaration
 * without turning this test red. Mirrors E0's "comment-aware" gate philosophy.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { planDeliberation } from '../../reflection/deliberation/planDeliberation.js';
import { prepareFusion } from '../../reflection/deliberation/prepareFusion.js';

// services/svc-ai-chat/src/tests/reflection/ -> repo root is five levels up.
const DOC_PATH = fileURLToPath(
  new URL('../../../../../docs/proposals/E1_SYNTHESIS_DELIBERATION_TOPOLOGY.md', import.meta.url),
);

describe('deliberation design gate — doc invariants cannot silently rot', () => {
  it('the design doc exists', () => {
    expect(existsSync(DOC_PATH), `missing design doc at ${DOC_PATH}`).toBe(true);
  });

  const doc = existsSync(DOC_PATH) ? readFileSync(DOC_PATH, 'utf8').toLowerCase() : '';

  const requiredMarkers: Array<[string, string]> = [
    ['default-single invariant', 'default topology = `single`'],
    ['no interactive fan-out', 'nikdy nefanoutuje'],
    ['never overspend', 'nikdy nepřekročit rozpočet'],
    ['champion/challenger mandatory acceptance', 'champion/challenger'],
    ['E0 non-duplication header', 'neduplikovat'],
    ['declares E0 lives on main', 'e0 worktree splynul do `main`'],
    ['declares ToT v1 lives on main', 'tot v1 nody i `reasoning-tree-reflect`'],
    ['does not redefine decision.ts', 'decision.ts'],
    ['rejects OpenRouter Fusion SaaS', 'openrouter fusion'],
    ['rejects Gavel SaaS', 'gavel'],
    ['references the planner symbol', 'plandeliberation'],
    ['references the fusion guard symbol', 'preparefusion'],
  ];

  for (const [label, marker] of requiredMarkers) {
    it(`declares: ${label}`, () => {
      expect(doc.includes(marker.toLowerCase()), `doc is missing marker for "${label}": ${marker}`).toBe(
        true,
      );
    });
  }

  it('the symbols the doc references actually exist in code', () => {
    expect(typeof planDeliberation).toBe('function');
    expect(typeof prepareFusion).toBe('function');
  });

  it('does not regress to stale branch-only status claims', () => {
    expect(doc).not.toContain('awesome-northcutt-e09ca7');
    expect(doc).not.toContain('zatím **nikde**');
    expect(doc).not.toContain('po splynutí e0');
  });
});
