-- Function: public.fn_create_approval_request
-- Persists a new approval request raised by WF_APPROVAL_GATE (Create Approval
-- node). The workflow supplies a client-generated approval id plus the
-- classification/risk context; this records it into the approval_requests ledger
-- so the decision state survives beyond the workflow run. Idempotent on the id.
-- Security: SECURITY DEFINER (service_role-invoked via aishaRpc), search_path pinned.

CREATE OR REPLACE FUNCTION public.fn_create_approval_request(
  p_approval_id        uuid,
  p_action_description text DEFAULT NULL,
  p_severity           text DEFAULT NULL,
  p_computed_risk      numeric DEFAULT NULL,
  p_agent_slug         text DEFAULT NULL,
  p_category           text DEFAULT NULL,
  p_source             text DEFAULT NULL,
  p_context            jsonb DEFAULT '{}'::jsonb,
  p_context_hash       text DEFAULT NULL,
  p_expires_at         timestamptz DEFAULT NULL,
  p_status             text DEFAULT 'pending'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.approval_requests
    (id, action_description, severity, computed_risk, agent_slug, category,
     source, context, context_hash, expires_at, status)
  VALUES
    (COALESCE(p_approval_id, gen_random_uuid()), p_action_description, p_severity,
     p_computed_risk, p_agent_slug, p_category, p_source,
     COALESCE(p_context, '{}'::jsonb), p_context_hash, p_expires_at,
     COALESCE(p_status, 'pending'))
  ON CONFLICT (id) DO UPDATE
    SET action_description = EXCLUDED.action_description,
        severity          = EXCLUDED.severity,
        computed_risk      = EXCLUDED.computed_risk,
        agent_slug         = EXCLUDED.agent_slug,
        category           = EXCLUDED.category,
        source             = EXCLUDED.source,
        context            = EXCLUDED.context,
        context_hash       = EXCLUDED.context_hash,
        expires_at         = EXCLUDED.expires_at,
        updated_at         = now()
  RETURNING id INTO v_id;

  INSERT INTO public.audit_journal
    (user_id, action_type, action, entity_type, entity_id, area, severity, summary, details)
  VALUES
    (NULL, 'create', 'APPROVAL_REQUESTED', 'approval_request', v_id::text,
     'system', COALESCE(p_severity, 'info'),
     'Approval request created',
     jsonb_build_object('agent_slug', p_agent_slug, 'category', p_category,
       'computed_risk', p_computed_risk, 'source', p_source));

  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.fn_create_approval_request(uuid, text, text, numeric, text, text, text, jsonb, text, timestamptz, text) IS
  'Persists a WF_APPROVAL_GATE approval request into approval_requests (idempotent on id).';

REVOKE ALL ON FUNCTION public.fn_create_approval_request(uuid, text, text, numeric, text, text, text, jsonb, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_approval_request(uuid, text, text, numeric, text, text, text, jsonb, text, timestamptz, text) TO service_role;
