-- Function: public.is_service_role
-- Description: The single canonical answer to "is the current request the
--   trusted service_role?" — boolean-NOT-NULL by construction.
--
--   Replaces the inline idiom
--     (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role'
--   which folds to SQL NULL when the `role` claim is absent (anon / a token with
--   no role), and a NULL then propagates through negative deny-guards
--   (`IF v_user_id IS NULL AND NOT v_is_service` / `IF NOT v_is_service AND ...`)
--   so `IF NULL` never RAISEs → the guard FAILS OPEN. Both disjuncts here
--   COALESCE to false, so the result is never NULL and any deny-guard built on
--   `NOT is_service_role()` is total (fails CLOSED).
--
--   Reuses get_jwt_role() as the single reader of request.jwt.claims (keeps the
--   legacy-GUC / JSON-claims compatibility in one place) and keeps the SET ROLE
--   GUC disjunct so an in-DB `SET ROLE service_role` caller is still recognised.
--
--   LANGUAGE plpgsql (not sql) so the body is not name-resolved at CREATE time —
--   this makes it ordering-immune on both the cold-start baseline and heals
--   (no dependency-ordering hazard vs get_jwt_role).
-- Security: SECURITY DEFINER, search_path pinned. Safe in RLS policies and
--   SECURITY DEFINER RPCs. Granted to anon too (returns false) so anon-granted
--   callers can adopt it without a permission-denied.

CREATE OR REPLACE FUNCTION public.is_service_role()
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  RETURN COALESCE(public.get_jwt_role() = 'service_role', false)
      OR COALESCE(current_setting('role', true) = 'service_role', false);
END;
$$;

REVOKE ALL ON FUNCTION public.is_service_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_service_role() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.is_service_role() IS
  'Boolean-NOT-NULL service_role detector. Canonical replacement for the inline '
  'request.jwt.claims->>''role''=''service_role'' idiom that folds to NULL (and '
  'fails OPEN in negative deny-guards) when the role claim is absent. Reuses '
  'get_jwt_role(); keeps the SET ROLE GUC disjunct. plpgsql = ordering-immune.';
