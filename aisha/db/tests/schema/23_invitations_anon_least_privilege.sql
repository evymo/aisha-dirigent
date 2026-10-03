-- pgTAP schema-contract test — audit C2: invitations anon least-privilege
-- ============================================================================
-- The invitations table carries the invite `code`, the intended `role`
-- (admin/staff/partner), and invitee email/PII. RLS filters ROWS, not COLUMNS,
-- so a table-level `GRANT SELECT ... TO anon` let an unauthenticated PostgREST
-- client enumerate every live invite (`GET /rest/v1/invitations?select=code,role,email`).
-- The fix removes the anon grant from BOTH SoT sources, drops the
-- "Public can read active invitations" policy, and adds `invitations` to the
-- fix_missing_table_grants blanket-loop exclusion so a cold-start never re-grants it.
--
-- The registration/redemption flow is unaffected: it goes through the
-- SECURITY DEFINER validate_invitation / claim_invitation RPCs, which execute
-- as the function owner and bypass table-level grants. This test locks both
-- invariants. Runs UNSEEDED in a rolled-back txn.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(3);

-- 1. The leak is closed: anon has NO direct SELECT on the table.
SELECT ok(
  NOT has_table_privilege('anon', 'public.invitations', 'SELECT'),
  'anon has NO SELECT on public.invitations (C2 — no code/role/PII enumeration via PostgREST)'
);

-- 2. Not over-revoked: authenticated still holds SELECT (owner/admin RLS gates rows).
SELECT ok(
  has_table_privilege('authenticated', 'public.invitations', 'SELECT'),
  'authenticated retains SELECT on public.invitations (RLS still gates rows to owner/admin)'
);

-- 3. Registration intact: anon retains EXECUTE on the SECURITY DEFINER validator.
SELECT ok(
  has_function_privilege('anon', 'public.validate_invitation(text)', 'EXECUTE'),
  'anon retains EXECUTE on validate_invitation (registration/redemption path intact)'
);

SELECT * FROM finish();
ROLLBACK;
