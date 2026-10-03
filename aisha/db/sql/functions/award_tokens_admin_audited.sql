-- Function: public.award_tokens_admin_audited
-- Arguments: p_amount integer, p_description text, p_reference_id uuid, p_reference_type text, p_token_type text, p_user_id uuid
-- Description: Admin path for granting tokens. Companion to award_tokens, which became
--   service_role-only in the 2026-07-15 IDOR fix (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md).
--
--   WHY A WRAPPER INSTEAD OF GRANTING award_tokens: the admin UI (src/hooks/useTokens.ts) calls
--   the RPC with a user JWT (role=authenticated). Its only protection used to be
--   useAdminGuard.guardAdminMutation — CLIENT-side React, which enforces nothing in the database,
--   so any logged-in user could POST /rest/v1/rpc/award_tokens directly and mint themselves
--   unlimited governance tokens. Here the admin check is enforced IN THE DATABASE: the grant lets
--   an admin's JWT reach the function, is_admin_or_staff() decides whether it proceeds.
--
-- Security: SECURITY DEFINER; is_admin_or_staff() fail-closed as the FIRST statement. That guard is
--   the ONLY authorization on this path — award_tokens itself performs none (its GRANT is its
--   boundary), and we reach it only because SECURITY DEFINER runs us as the owner, who holds
--   EXECUTE by ownership. Do not remove the guard without replacing it.
-- Params: alphabetical (generated TS types are ordered alphabetically — see
--   src/tests/db/rpc-params-alphabetical.test.ts). PostgreSQL requires defaults to trail, so the
--   required p_token_type/p_user_id carry defaults and are NULL-checked in the body instead.
-- @audit: token.admin_awarded — an admin touching someone else's ledger MUST leave a trace; the
--   token_transactions row alone is not one, since the admin authored it.

CREATE OR REPLACE FUNCTION public.award_tokens_admin_audited(
  p_amount         integer,
  p_description    text DEFAULT NULL::text,
  p_reference_id   uuid DEFAULT NULL::uuid,
  p_reference_type text DEFAULT NULL::text,
  p_token_type     text DEFAULT NULL::text,
  p_user_id        uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- AUTHORIZATION FIRST — before the audit row and before any ledger touch.
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff required' USING ERRCODE = '42501';
  END IF;

  -- Required despite carrying defaults (see Params note above) — fail loud, do not coalesce.
  IF p_user_id IS NULL OR p_token_type IS NULL THEN
    RAISE EXCEPTION 'p_user_id and p_token_type are required' USING ERRCODE = '22023';
  END IF;

  -- award_tokens validates the amount and token type and does the minting.
  v_result := public.award_tokens(
    p_user_id, p_token_type, p_amount, p_reference_type, p_reference_id, p_description
  );

  PERFORM public.write_audit_journal(
    p_action_type := 'update'::journal_action_type,
    p_area        := 'tokens'::journal_area,
    p_details     := jsonb_build_object(
      'target_user_id', p_user_id,
      'token_type', p_token_type,
      'amount', p_amount,
      'reference_type', p_reference_type,
      'reference_id', p_reference_id,
      'description', p_description
    ),
    p_entity_id   := p_user_id::text,
    p_entity_type := 'token_transaction',
    p_severity    := 'warning'::journal_severity,
    p_summary     := format('Admin awarded %s %s tokens', p_amount, p_token_type),
    p_tags        := ARRAY['tokens', 'admin', 'ledger'],
    p_user_id     := auth.uid()
  );

  RETURN v_result;
END;
$function$
;

-- Permissions
-- The GRANT lets an admin's browser JWT reach the function; is_admin_or_staff() above decides
-- whether it proceeds. A non-admin authenticated caller gets 42501.
REVOKE ALL ON FUNCTION public.award_tokens_admin_audited(p_amount integer, p_description text, p_reference_id uuid, p_reference_type text, p_token_type text, p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_tokens_admin_audited(p_amount integer, p_description text, p_reference_id uuid, p_reference_type text, p_token_type text, p_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.award_tokens_admin_audited(p_amount integer, p_description text, p_reference_id uuid, p_reference_type text, p_token_type text, p_user_id uuid) TO service_role;
