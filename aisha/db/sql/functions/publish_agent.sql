-- Function: public.publish_agent
-- Arguments: p_plugin_id uuid
-- Returns: jsonb (status + queue_id + message)
-- Security: SECURITY DEFINER
-- Description: Submits a kind='agent' plugin for moderation review. Mirrors
--   publish_expert_rule: the agent transitions to 'reviewing' status and enters
--   the polymorphic knowledge_moderation_queue (resource_type='agent',
--   resource_id = plugin_catalog.id). AISHA evaluates via the WF_KB_COMPLIANCE_GATE
--   webhook (best-effort), then service_role calls fn_aisha_kb_decision to
--   approve (→ canary) / reject (→ submitted). Until then a human admin can decide
--   via review_moderation_item.
--
--   Difference vs publish_expert_rule (intentional, safer for executable content):
--   if the n8n webhook is unconfigured or fails, the item stays PENDING for human
--   review — it is never auto-approved. We never call fn_aisha_kb_decision with the
--   invalid 'pending_review' decision (a latent bug in publish_expert_rule).

CREATE OR REPLACE FUNCTION public.publish_agent(p_plugin_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id   uuid;
  v_is_admin    boolean;
  v_partner_id  uuid;
  v_plugin      record;
  v_queue_id    uuid;
  v_existing    uuid;
  v_risk_tags   text[];
  v_webhook_url text;
  v_request_id  bigint;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_is_admin := public.is_admin_or_staff();

  SELECT pc.id, pc.slug, pc.name, pc.description, pc.kind, pc.status,
         pc.capabilities, pc.author_partner_id
    INTO v_plugin
    FROM public.plugin_catalog pc
   WHERE pc.id = p_plugin_id;

  IF v_plugin.id IS NULL THEN
    RAISE EXCEPTION 'Agent not found: %', p_plugin_id;
  END IF;

  IF v_plugin.kind <> 'agent' THEN
    RAISE EXCEPTION 'Plugin % is not an agent (kind=%)', p_plugin_id, v_plugin.kind;
  END IF;

  -- Ownership: the authoring certified partner, or admin/staff.
  IF NOT v_is_admin THEN
    SELECT id INTO v_partner_id
      FROM public.partner_profiles
     WHERE user_id = v_caller_id;
    IF v_partner_id IS NULL OR v_plugin.author_partner_id IS DISTINCT FROM v_partner_id THEN
      RAISE EXCEPTION 'Only the authoring partner or admin/staff can publish this agent';
    END IF;
  END IF;

  -- Idempotency: if a review is already pending, return it (checked BEFORE the
  -- publishable-state gate, because a pending agent is already in 'reviewing').
  SELECT id INTO v_existing
    FROM public.knowledge_moderation_queue
   WHERE resource_type = 'agent'
     AND resource_id = p_plugin_id
     AND status = 'pending'
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'review',
      'queue_id', v_existing,
      'message', 'Agent already pending review'
    );
  END IF;

  -- Publishable only from a pre-review state.
  IF v_plugin.status NOT IN ('submitted'::public.plugin_status) THEN
    RAISE EXCEPTION 'Agent % is not in a publishable state (status=%)', p_plugin_id, v_plugin.status;
  END IF;

  -- Transition to 'reviewing' — decision will flip to canary/submitted.
  UPDATE public.plugin_catalog
     SET status = 'reviewing'::public.plugin_status, updated_at = now()
   WHERE id = p_plugin_id;

  -- Risk tags derived from declared capabilities (for the compliance evaluator).
  v_risk_tags := ARRAY(
    SELECT jsonb_array_elements_text(COALESCE(v_plugin.capabilities, '[]'::jsonb))
  );

  -- Enter the polymorphic moderation queue.
  INSERT INTO public.knowledge_moderation_queue
    (resource_type, resource_id, status, risk_tags)
  VALUES
    ('agent', p_plugin_id, 'pending', v_risk_tags)
  RETURNING id INTO v_queue_id;

  -- Audit
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_caller_id, 'AGENT_PUBLISH_REQUESTED', jsonb_build_object(
    'area', 'marketplace',
    'severity', 'info',
    'plugin_id', p_plugin_id,
    'queue_id', v_queue_id,
    'slug', v_plugin.slug
  ));

  -- Fire AISHA compliance webhook (best-effort). Unlike publish_expert_rule we
  -- do NOT auto-approve when n8n is absent — agents stay pending for human review.
  BEGIN
    v_webhook_url := current_setting('app.settings.n8n_webhook_base_url', true);
    IF v_webhook_url IS NOT NULL AND v_webhook_url <> '' THEN
      SELECT net.http_post(
        url     := v_webhook_url || '/webhook/kb-compliance-gate',
        body    := jsonb_build_object(
          'queue_id', v_queue_id,
          'resource_type', 'agent',
          'plugin_id', p_plugin_id,
          'slug', v_plugin.slug,
          'name', v_plugin.name,
          'description', v_plugin.description,
          'capabilities', COALESCE(v_plugin.capabilities, '[]'::jsonb),
          'requester_id', v_caller_id,
          'action', 'publish_agent'
        ),
        headers := '{"Content-Type": "application/json"}'::jsonb
      ) INTO v_request_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- pg_net unavailable / webhook post failed → leave PENDING for human review.
    INSERT INTO public.audit_journal (user_id, action, metadata)
    VALUES (v_caller_id, 'AGENT_APPROVAL_ESCALATED', jsonb_build_object(
      'area', 'marketplace',
      'severity', 'warning',
      'plugin_id', p_plugin_id,
      'queue_id', v_queue_id,
      'reason', 'AISHA evaluation unavailable — awaiting manual review',
      'error', SQLERRM
    ));
  END;

  RETURN jsonb_build_object(
    'status', 'review',
    'queue_id', v_queue_id,
    'message', 'Submitted for compliance review'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.publish_agent(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_agent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_agent(uuid) TO service_role;
