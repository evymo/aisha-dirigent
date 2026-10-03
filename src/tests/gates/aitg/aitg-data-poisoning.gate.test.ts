/**
 * AITG-INF-05 (Fine-tuning Poisoning) + AITG-MOD-03 (Poisoned Training Sets).
 *
 * The orchestrator has NO fine-tuning / training pipeline, so there is no model
 * weight or training set to poison directly. The stack ANALOG of "the data that
 * shapes future behaviour" is two real surfaces — and both are defended. This
 * gate asserts those structural defenses at the SoT so a regression reds offline:
 *
 *   1. RAG corpus ingestion (knowledge_items): a prompt-injection / poisoned-
 *      content guard runs at ingestion time
 *      (services/svc-mcp-knowledge/src/lib/ingestion-safety.ts).
 *   2. The learning loop (improvement_proposals -> expert_rules): a learning NEVER
 *      auto-promotes to an active rule. fn_maybe_promote_learning writes a
 *      'pending_review' improvement_proposal; promotion to expert_rules requires an
 *      explicit human/admin approval. So a poisoned learning cannot silently become
 *      a behaviour-changing rule (advisory-only invariant).
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

describe('AITG-INF-05 / AITG-MOD-03 — data-poisoning resistance (corpus + learning-loop analog)', () => {
  test('RAG ingestion runs a poisoned-content / prompt-injection guard', () => {
    const scanner = read('services/svc-mcp-knowledge/src/lib/ingestion-safety.ts');
    expect(scanner.length, 'ingestion-safety scanner lib is missing').toBeGreaterThan(200);
    expect(
      scanner,
      'ingestion scanner has no injection/quarantine/sanitise logic',
    ).toMatch(/inject|quarantin|sanitis|sanitiz|suspicious|guard/i);
  });

  test('learning loop is human-gated: fn_maybe_promote_learning writes a pending_review proposal, never an active rule', () => {
    const fn = read('aisha/db/sql/functions/fn_maybe_promote_learning.sql');
    expect(fn.length, 'fn_maybe_promote_learning SoT is missing').toBeGreaterThan(200);
    // Promotes into the proposal queue, NOT directly into expert_rules.
    expect(fn, 'promotion must go through improvement_proposals').toMatch(
      /insert\s+into\s+(public\.)?improvement_proposals/i,
    );
    // A learning lands as pending_review — never auto-approved / active.
    expect(fn, "a learning must land as 'pending_review', not auto-approved").toMatch(/'pending_review'/);
    // It must NOT directly insert an active expert_rule — that is the human gate's job.
    expect(
      /insert\s+into\s+(public\.)?expert_rules/i.test(fn),
      'fn_maybe_promote_learning must NOT insert directly into expert_rules',
    ).toBe(false);
  });

  test('promotion to expert_rules requires an explicit admin/staff approval RPC', () => {
    const approve = read('aisha/db/sql/functions/approve_improvement_proposal_admin.sql');
    const review = read('aisha/db/sql/functions/review_moderation_item.sql');
    expect(
      (approve + review).length,
      'no human-approval RPC found for improvement_proposals promotion',
    ).toBeGreaterThan(200);
    expect(
      approve + review,
      'the approval RPC must be admin/staff gated (not callable by any authed user)',
    ).toMatch(/is_admin|is_staff|admin_or_staff|require_admin|'admin'|'staff'/i);
  });
});
