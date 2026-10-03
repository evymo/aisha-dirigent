/**
 * Gate: get_my_pending_consents reader.
 *
 * The member charter-signing surface needs a first-class "what do I still need to
 * sign" endpoint. This locks its semantics: caller-scoped, only active registrations,
 * only not-yet-accepted (and not-revoked) requirements inside their validity window.
 * (The React page that consumes it is built against generated types after typegen.)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const FN = fs.readFileSync(path.join(ROOT, 'aisha/db/sql/functions/get_my_pending_consents.sql'), 'utf8');

describe('get_my_pending_consents', () => {
  it('is a caller-scoped SECURITY DEFINER reader', () => {
    expect(FN).toMatch(/CREATE OR REPLACE FUNCTION public\.get_my_pending_consents/);
    expect(FN).toMatch(/SECURITY DEFINER/);
    expect(FN).toMatch(/v_user_id uuid := auth\.uid\(\)/);
    expect(FN).toMatch(/sr\.user_id = v_user_id/);
  });

  it('returns only outstanding (not-yet-accepted) requirements for active registrations', () => {
    expect(FN).toMatch(/sr\.status IN \('enrolled', 'active'\)/);
    expect(FN).toMatch(/LEFT JOIN public\.study_consent_acceptances/);
    expect(FN).toMatch(/sca\.revoked_at IS NULL/);
    expect(FN).toMatch(/sca\.id IS NULL/);
  });

  it('honors the requirement validity window', () => {
    expect(FN).toMatch(/scr\.valid_from IS NULL OR now\(\) >= scr\.valid_from/);
    expect(FN).toMatch(/scr\.valid_until IS NULL OR now\(\) <= scr\.valid_until/);
  });
});
