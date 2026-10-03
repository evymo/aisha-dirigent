-- ============================================================================
-- Source of Truth: aisha_pre_request  (PostgREST db-pre-request hook)
-- Purpose: Wire the documented "first-request hook" — public.ensure_current_user
--          — as PostgREST's global PGRST_DB_PRE_REQUEST, so EVERY authenticated
--          request JIT-provisions its caller into aisha_auth.users BEFORE the
--          request body runs. Without this, a Keycloak user created after the
--          bootstrap import has a valid JWT (auth.uid() resolves) but no
--          aisha_auth.users row, and the first write to ANY of the ~dozens of
--          tables whose user_id FKs aisha_auth.users (consents, chat_*, health_*,
--          notification_preferences, …) fails with FK 23503 → PostgREST 409.
--          Per-function ensure_current_user() calls only cover the functions that
--          remember to call it (a fragile minority); a single pre-request hook
--          closes the entire class centrally.
--
-- Contract (PostgREST db-pre-request):
--   - runs ONCE before every request, as the request role (anon / authenticated
--     / service_role) — hence EXECUTE is granted to all three;
--   - takes no args, returns void;
--   - MUST NOT raise: any error here fails the whole request. This is wrapped so
--     provisioning is strictly best-effort — a write that still needs the row
--     surfaces its own error, and reads never depend on it.
--
-- Read-only guard: PostgREST GET runs in a READ ONLY transaction; reads never
--   write an FK row, and the ensure_current_user INSERT would error there. We
--   skip provisioning on read-only transactions (the EXCEPTION block is a
--   second backstop).
--
-- Security: SECURITY DEFINER so the body may call ensure_current_user (and thus
--   INSERT into aisha_auth.users) regardless of the request role's own grants.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.aisha_pre_request()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'aisha_auth'
AS $$
BEGIN
  -- Reads (read-only tx) never need provisioning and cannot INSERT — skip.
  IF current_setting('transaction_read_only', true) = 'on' THEN
    RETURN;
  END IF;

  -- JIT-provision the authenticated caller. Idempotent (fast EXISTS path);
  -- returns NULL for anon / service callers with no JWT subject (a no-op).
  PERFORM public.ensure_current_user();
EXCEPTION WHEN OTHERS THEN
  -- Never block a request on best-effort provisioning.
  NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.aisha_pre_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aisha_pre_request() TO anon;
GRANT EXECUTE ON FUNCTION public.aisha_pre_request() TO authenticated;
GRANT EXECUTE ON FUNCTION public.aisha_pre_request() TO service_role;

COMMENT ON FUNCTION public.aisha_pre_request() IS
  'PostgREST db-pre-request hook (set PGRST_DB_PRE_REQUEST=public.aisha_pre_request). JIT-provisions the authenticated caller via ensure_current_user before every request so FK-to-aisha_auth.users writes never 409; no-op on read-only tx and for anon. Exception-safe — never blocks a request.';
