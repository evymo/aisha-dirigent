-- ============================================================================
-- Source of Truth: log_security_event
--
-- OWASP A09 — append-only audit trail for security events emitted by orchestrator
-- services. Called from @aisha/security/audit.ts (createPostgrestAuditEmitter).
--
-- Distinct from log_integration_action which targets integration_services
-- bookkeeping (NocoDB/Langfuse): this one is for cross-cutting security
-- events (auth fail, MFA challenge, rate-limit hit, SSRF block, etc.) and
-- writes directly to audit_journal with area='security' and tags=['owasp', …].
--
-- Authorization:
--   - authenticated → may log events about their own session (actor=auth.uid())
--   - service_role  → may log events on behalf of any actor (n8n, services)
--   - anon          → only when service_role bridge passes through (rare)
--
-- Metadata is JSONB; callers are responsible for redacting PII upstream
-- (the @aisha/security logger applies redact() before transport).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.log_security_event(
  p_service     text,
  p_action      text,
  p_actor_id    uuid     DEFAULT NULL,
  p_target_type text     DEFAULT NULL,
  p_target_id   text     DEFAULT NULL,
  p_outcome     text     DEFAULT 'allow',
  p_reason      text     DEFAULT NULL,
  p_metadata    jsonb    DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id              uuid;
  v_is_service_role boolean;
  v_actor           uuid;
BEGIN
  -- Validate outcome enum (defensive: prevents free-form values from polluting
  -- the audit trail and breaking downstream dashboards / alert rules).
  IF p_outcome NOT IN ('allow', 'deny', 'error') THEN
    RAISE EXCEPTION 'log_security_event: invalid outcome %, expected allow|deny|error', p_outcome;
  END IF;

  v_is_service_role := (current_setting('request.jwt.claims', true)::jsonb->>'role') = 'service_role';

  -- service_role may log with any actor; authenticated users may only log
  -- events about themselves. This stops a compromised user JWT from forging
  -- audit entries for other principals.
  IF v_is_service_role THEN
    v_actor := COALESCE(p_actor_id, auth.uid());
  ELSE
    IF p_actor_id IS NOT NULL AND p_actor_id <> auth.uid() THEN
      RAISE EXCEPTION 'log_security_event: actor mismatch (caller=%, requested=%)',
        auth.uid(), p_actor_id;
    END IF;
    v_actor := auth.uid();
  END IF;

  INSERT INTO public.audit_journal (
    user_id,
    action,
    action_type,
    entity_type,
    entity_id,
    area,
    severity,
    summary,
    details,
    metadata,
    tags
  ) VALUES (
    v_actor,
    p_action,
    p_action,
    p_target_type,
    p_target_id,
    'security',
    CASE p_outcome WHEN 'deny' THEN 'warn' WHEN 'error' THEN 'error' ELSE 'info' END,
    p_reason,
    jsonb_build_object(
      'service',  p_service,
      'outcome',  p_outcome,
      'reason',   p_reason
    ),
    p_metadata,
    ARRAY['owasp', p_outcome, p_service]
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_security_event(text, text, uuid, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_security_event(text, text, uuid, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_security_event(text, text, uuid, text, text, text, text, jsonb) TO service_role;
