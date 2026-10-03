/**
 * Gate: consent-acceptance integrity + knowledge-topic parent visibility.
 *
 * submit_study_consent_acceptance is the e-signature evidence writer. This gate locks
 * the integrity guards so they cannot silently regress:
 *   - a signature-required template cannot be accepted with a blank/NULL signature;
 *   - a retired (is_active = false) template cannot be accepted;
 *   - the requirement's validity window is enforced;
 *   - a recorded signature is immutable-once-set (no overwrite via re-grant).
 *
 * It also locks get_knowledge_topic_posts_localized against the parent-visibility leak
 * (an authenticated user reading posts of an 'internal' topic they cannot see).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string): string => {
  const fp = path.join(ROOT, rel);
  return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
};

const SUBMIT = read('aisha/db/sql/functions/submit_study_consent_acceptance.sql');
const POSTS = read('aisha/db/sql/functions/get_knowledge_topic_posts_localized.sql');

describe('consent-acceptance integrity', () => {
  it('rejects a blank signature when the template requires one', () => {
    expect(SUBMIT).toMatch(
      /v_template\.requires_signature AND COALESCE\(btrim\(p_signature_data\), ''\) = ''/,
    );
    expect(SUBMIT).toMatch(/'Signature required'/);
  });

  it('rejects an inactive template', () => {
    expect(SUBMIT).toMatch(/IF NOT v_template\.is_active THEN/);
  });

  it('enforces the requirement validity window', () => {
    expect(SUBMIT).toMatch(/v_requirement\.valid_from IS NOT NULL AND now\(\) < v_requirement\.valid_from/);
    expect(SUBMIT).toMatch(/v_requirement\.valid_until IS NOT NULL AND now\(\) > v_requirement\.valid_until/);
  });

  it('keeps a recorded signature immutable-once-set (no overwrite via re-grant)', () => {
    // existing value wins over EXCLUDED — the opposite order would let a re-grant overwrite it.
    expect(SUBMIT).toMatch(
      /signature_data = COALESCE\(public\.study_consent_acceptances\.signature_data, EXCLUDED\.signature_data\)/,
    );
    expect(SUBMIT).toMatch(
      /signature_data = COALESCE\(public\.consents\.signature_data, EXCLUDED\.signature_data\)/,
    );
  });
});

describe('knowledge-topic parent visibility', () => {
  it('re-checks the parent topic visibility (internal → staff only)', () => {
    expect(POSTS).toMatch(/JOIN knowledge_topics kt ON kt\.id = kp\.topic_id/);
    expect(POSTS).toMatch(/kt\.visibility <> 'internal' OR public\.is_admin_or_staff\(auth\.uid\(\)\)/);
  });
});
