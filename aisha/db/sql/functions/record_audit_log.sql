-- Function: public.record_audit_log
-- Arguments: p_action text, p_resource_type text, p_resource_id text, p_user_id uuid, p_details jsonb
-- Description: Wrapper for integration audit logs (edge functions, service role).
-- Security: SECURITY DEFINER. Thin wrapper over write_audit_journal, so it inherits that
--   function's privilege: it forwards p_user_id straight through as the journal actor.
--   2026-07-15 IDOR fix (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md): despite the
--   "edge functions, service role" description above, it was GRANTed to `authenticated` — so it
--   was a second, unguarded door to exactly the audit-attribution forgery that revoking
--   write_audit_journal closes. Revoking only the inner function would have left this one open,
--   which is why both ship in the same commit. Its sole in-DB caller,
--   handle_order_payment_completed, is SECURITY DEFINER and runs as the owner, so it is unaffected.
--   No frontend or service code calls this RPC.

CREATE OR REPLACE FUNCTION public.record_audit_log(
  p_action text,
  p_resource_type text,
  p_resource_id text,
  p_user_id uuid DEFAULT NULL::uuid,
  p_details jsonb DEFAULT NULL::jsonb
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_summary text;
BEGIN
  v_summary := format('Integration event: %s', p_action);

  RETURN public.write_audit_journal(
    p_action_type := 'integration'::journal_action_type,
    p_area := 'integration'::journal_area,
    p_details := jsonb_build_object(
      'action', p_action,
      'details', p_details
    ),
    p_entity_id := p_resource_id,
    p_entity_type := p_resource_type,
    p_new_values := NULL,
    p_old_values := NULL,
    p_severity := 'info'::journal_severity,
    p_summary := v_summary,
    p_tags := ARRAY['integration', 'audit'],
    p_user_id := p_user_id
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.record_audit_log(p_action text, p_resource_type text, p_resource_id text, p_user_id uuid, p_details jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_audit_log(p_action text, p_resource_type text, p_resource_id text, p_user_id uuid, p_details jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_audit_log(p_action text, p_resource_type text, p_resource_id text, p_user_id uuid, p_details jsonb) TO service_role;
