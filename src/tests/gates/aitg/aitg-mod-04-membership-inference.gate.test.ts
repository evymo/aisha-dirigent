/**
 * AITG-MOD-04 — Membership Inference.
 *
 * No training set exists, so "was record X in the training data?" maps to the
 * stack's real boundary: "can a caller infer whether a document exists in ANOTHER
 * story's knowledge base?". The defense is the per-story KB isolation — the RAG
 * readers are SECURITY DEFINER and RE-IMPOSE the story-ownership boundary in-body
 * (a non-service_role caller may only read a story they own), so a probing query
 * against an arbitrary p_story_id can neither confirm nor deny membership of
 * another user's chunks. End-to-end proof is the pgTAP suite
 * aisha/db/tests/schema/02_rag_isolation_rbac.sql (cold-start gate); this gate
 * locks the SoT-level structural defense in offline CI.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
function read(p: string): string {
  const full = resolve(ROOT, p);
  return existsSync(full) ? readFileSync(full, 'utf8') : '';
}

// The SECURITY DEFINER RAG readers that would otherwise let a caller probe an
// arbitrary story's corpus. Each must re-impose the story-ownership boundary.
const STORY_SCOPED_READERS = ['mcp_search_knowledge_v3', 'compose_context'];

describe('AITG-MOD-04 — membership-inference resistance (per-story KB isolation)', () => {
  for (const fnName of STORY_SCOPED_READERS) {
    test(`${fnName} is SECURITY DEFINER and re-imposes the per-story ownership boundary`, () => {
      const fn = read(`aisha/db/sql/functions/${fnName}.sql`);
      expect(fn.length, `${fnName} SoT is missing`).toBeGreaterThan(200);
      expect(fn, `${fnName} must be SECURITY DEFINER`).toMatch(/security\s+definer/i);
      // The membership-inference guard: the function is story-scoped …
      expect(fn, `${fnName} must be story-scoped (story_id)`).toMatch(/story_id/i);
      // … and a non-service_role caller is bound to a story they actually own —
      // it must NOT trust an arbitrary p_story_id. Accept any of the canonical
      // ownership checks (direct user_id match or the participant/membership helper).
      expect(
        /ps\.user_id|user_id\s*=\s*\w*caller|story_participants|is_story_participant|participant_/i.test(fn),
        `${fnName} must verify story ownership/membership, not trust an arbitrary p_story_id`,
      ).toBe(true);
    });
  }

  test('the runtime proof exists: rag-isolation pgTAP suite (cold-start gate)', () => {
    expect(
      existsSync(resolve(ROOT, 'aisha/db/tests/schema/02_rag_isolation_rbac.sql')),
      'rag-isolation pgTAP suite is missing — runtime membership-inference proof gone',
    ).toBe(true);
  });
});
