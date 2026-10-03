/**
 * Gate: System-B per-cohort test driver.
 *
 * study_test_templates -> test_templates -> test_attempts was schema-ready but had no
 * driver (nothing created/graded attempts) and clients held full write access to
 * test_attempts (forgeable passes). This locks the server driver:
 *   - start_test_attempt gates on enrollment (study_test_templates ∩ study_registrations);
 *   - submit_test_attempt grades server-side against test_questions and is idempotent;
 *   - clients cannot write test_attempts directly (SELECT-own only).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string): string => {
  const fp = path.join(ROOT, rel);
  return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
};
const code = (s: string): string => s.replace(/^[ \t]*--.*$/gm, '');

const START = read('aisha/db/sql/functions/start_test_attempt.sql');
const SUBMIT = read('aisha/db/sql/functions/submit_test_attempt.sql');
const GRANTS = read('aisha/db/sql/grants/test_attempts.sql');

describe('System-B test driver', () => {
  it('start_test_attempt is a SECURITY DEFINER, enrollment-gated opener', () => {
    expect(START).toMatch(/CREATE OR REPLACE FUNCTION public\.start_test_attempt/);
    expect(START).toMatch(/SECURITY DEFINER/);
    expect(START).toMatch(/study_test_templates[\s\S]{0,200}JOIN[\s\S]{0,120}study_registrations/);
  });

  it('submit_test_attempt grades server-side and is single-shot', () => {
    expect(SUBMIT).toMatch(/CREATE OR REPLACE FUNCTION public\.submit_test_attempt/);
    expect(SUBMIT).toMatch(/SECURITY DEFINER/);
    // grades against the template's questions, compares to correct_answer
    expect(SUBMIT).toMatch(/FROM public\.test_questions[\s\S]{0,120}template_id = v_attempt\.template_id/);
    expect(SUBMIT).toMatch(/= v_q\.correct_answer/);
    expect(SUBMIT).toMatch(/passing_score/);
    // one submission per attempt
    expect(SUBMIT).toMatch(/v_attempt\.completed_at IS NOT NULL/);
    // subject is the caller
    expect(SUBMIT).toMatch(/v_attempt\.user_id <> v_user_id/);
  });

  it('clients cannot write test_attempts directly (SELECT-own only)', () => {
    expect(code(GRANTS)).not.toMatch(/GRANT[^;]*\b(INSERT|UPDATE|DELETE)\b[^;]*TO authenticated/);
    expect(GRANTS).toMatch(/GRANT SELECT ON public\.test_attempts TO authenticated/);
  });
});
