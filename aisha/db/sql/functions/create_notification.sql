-- Function: public.create_notification
-- Arguments: p_user_id uuid, p_title text, p_message text, p_type text, p_link text
-- Description: Internal notification writer. Inserts a row into another user's notification feed
--   on behalf of a trusted caller — never on behalf of the browser.
-- Security: SECURITY DEFINER, service_role + in-DB SECURITY DEFINER callers only.
--   2026-07-15 IDOR fix (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md): GRANTed to
--   `authenticated` with no authorization and no validation, this was a phishing primitive —
--   any logged-in user could POST /rest/v1/rpc/create_notification and place an arbitrary
--   title, message and LINK into ANY user's notification feed, where the UI renders it as a
--   trusted first-party message. Nothing in the codebase calls this RPC, so the grant bought
--   nothing. src/tests/gates/security-hardened-helpers.gate.test.ts already listed this
--   function as MUST_BE_INTERNAL_ONLY, but its assertion was commented out pending a "Phase 2"
--   that never landed, so the violation only ever surfaced as a console.warn. That assertion is
--   enabled in the same commit as this fix.
-- Extracted: 2026-01-08T18:26:06+01:00

CREATE OR REPLACE FUNCTION public.create_notification(p_user_id uuid, p_title text, p_message text, p_type text DEFAULT 'info'::text, p_link text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_notification_id UUID;
BEGIN
  INSERT INTO notifications (user_id, title, message, type, link)
  VALUES (p_user_id, p_title, p_message, p_type, p_link)
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_notification(p_user_id uuid, p_title text, p_message text, p_type text, p_link text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_notification(p_user_id uuid, p_title text, p_message text, p_type text, p_link text) TO service_role;
