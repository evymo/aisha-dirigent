/**
 * AITG-MOD-05 — Inversion Attacks.
 *
 * No model weights to invert; the stack analog is "can an attacker reconstruct the
 * hidden CONTEXT (system prompt + retrieved chunks) from model outputs?". The
 * defense is structural and twofold:
 *   1. Context assembly + retrieval happen SERVER-SIDE in SECURITY DEFINER RPCs
 *      that are story-gated, so a model's output can only ever reflect the caller's
 *      OWN context — there is no cross-tenant context to invert.
 *   2. The system prompt never ships to the client, so it cannot be read directly
 *      (the canonical, stricter scan is AITG-APP-07 prompt-disclosure).
 *
 * This gate asserts both legs at the SoT so a regression reds offline.
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

describe('AITG-MOD-05 — context-inversion resistance', () => {
  test('context assembly is server-side + story-gated (no cross-tenant context to invert)', () => {
    const cc = read('aisha/db/sql/functions/compose_context.sql');
    expect(cc.length, 'compose_context SoT is missing').toBeGreaterThan(200);
    expect(cc, 'compose_context must be SECURITY DEFINER (server-side assembly)').toMatch(
      /security\s+definer/i,
    );
    expect(cc, 'compose_context must be story-scoped so outputs reflect only the caller context').toMatch(
      /story_id/i,
    );
  });

  test('retrieved chunks are story-gated at the reader (no other-tenant context reaches the model)', () => {
    const reader = read('aisha/db/sql/functions/mcp_search_knowledge_v3.sql');
    expect(reader.length, 'mcp_search_knowledge_v3 SoT is missing').toBeGreaterThan(200);
    expect(reader, 'the RAG reader must be SECURITY DEFINER').toMatch(/security\s+definer/i);
    expect(
      /ps\.user_id|story_participants|is_story_participant|participant_/i.test(reader),
      'the RAG reader must bind a non-service_role caller to a story they own',
    ).toBe(true);
  });

  test('the system-prompt-not-in-client invariant is enforced by the AITG-APP-07 scan', () => {
    const app07 = read('src/tests/gates/aitg/aitg-app-07-prompt-disclosure.gate.test.ts');
    expect(app07.length, 'AITG-APP-07 prompt-disclosure gate is missing').toBeGreaterThan(200);
    expect(
      app07,
      'AITG-APP-07 must scan client bundles for system-prompt markers (the inversion read-side surface)',
    ).toMatch(/SYSTEM_PROMPT_MARKERS/);
  });
});
