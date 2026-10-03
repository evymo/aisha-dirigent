-- Function: public.publish_expert_rule
-- Arguments: p_rule_id uuid
-- Returns: jsonb  (status + queue_id + message)
-- Security: SECURITY DEFINER
-- Description: Submits an expert rule for AISHA compliance review instead of
--   directly publishing. The rule transitions to 'review' status and enters
--   the knowledge_moderation_queue. AISHA evaluates via n8n webhook
--   (WF_KB_COMPLIANCE_GATE), then calls fn_aisha_kb_decision to approve/reject.
--   Fallback: auto-approves if AISHA is unavailable.

CREATE OR REPLACE FUNCTION public.publish_expert_rule(p_rule_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id   uuid;
  v_rule        record;
  v_queue_id    uuid;
  v_webhook_url text;
  v_request_id  bigint;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Must be owner and in publishable state
  SELECT er.id, er.title, er.summary, er.body_markdown,
         er.category::text AS category, er.ai_context_tags, er.slug
    INTO v_rule
    FROM expert_rules er
    JOIN partner_profiles pp ON pp.id = er.author_partner_id
   WHERE er.id = p_rule_id
     AND pp.user_id = v_caller_id
     AND er.status IN ('draft', 'review');

  IF v_rule IS NULL THEN
    RAISE EXCEPTION 'Rule not found, not owned, or not in publishable state';
  END IF;

  -- Transition to 'review' — AISHA will decide
  UPDATE expert_rules
     SET status = 'review', updated_at = now()
   WHERE id = p_rule_id;

  -- Create moderation queue entry
  INSERT INTO knowledge_moderation_queue
    (resource_type, resource_id, status, risk_tags)
  VALUES
    ('expert_rule', p_rule_id, 'pending', v_rule.ai_context_tags)
  RETURNING id INTO v_queue_id;

  -- Audit
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (v_caller_id, 'EXPERT_RULE_PUBLISH_REQUESTED', jsonb_build_object(
    'area', 'knowledge',
    'severity', 'info',
    'rule_id', p_rule_id,
    'queue_id', v_queue_id,
    'title', v_rule.title
  ));

  -- Fire n8n webhook for AISHA evaluation (best-effort)
  BEGIN
    v_webhook_url := current_setting('app.settings.n8n_webhook_base_url', true);
    IF v_webhook_url IS NOT NULL AND v_webhook_url != '' THEN
      SELECT net.http_post(
        url     := v_webhook_url || '/webhook/kb-compliance-gate',
        body    := jsonb_build_object(
          'queue_id', v_queue_id,
          'rule_id', p_rule_id,
          'slug', v_rule.slug,
          'title', v_rule.title,
          'summary', v_rule.summary,
          'category', v_rule.category,
          'body_preview', left(v_rule.body_markdown, 1000),
          'ai_context_tags', to_jsonb(COALESCE(v_rule.ai_context_tags, ARRAY[]::text[])),
          'requester_id', v_caller_id,
          'action', 'publish'
        ),
        headers := '{"Content-Type": "application/json"}'::jsonb
      ) INTO v_request_id;
    ELSE
      -- n8n not configured → auto-approve
      PERFORM fn_aisha_kb_decision(
        p_queue_id := v_queue_id,
        p_decision := 'approved',
        p_evaluation := jsonb_build_object(
          'auto', true,
          'reason', 'n8n webhook not configured, auto-approved'
        )
      );
      RETURN jsonb_build_object(
        'status', 'published',
        'queue_id', v_queue_id,
        'message', 'Auto-approved (AISHA not available)'
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- pg_net unavailable or webhook failed → leave the queue row PENDING for human
    -- review (NEVER auto-approve on failure). The rule already sits at 'review' and
    -- the queue row was inserted as 'pending' above — both are outside this inner
    -- BEGIN block, so they survive the subtransaction rollback. We must NOT call
    -- fn_aisha_kb_decision here: 'pending_review' is not a valid decision (it
    -- validates approved|rejected|escalated), so the call RAISEd inside this handler
    -- and aborted the whole publish (rule + queue lost). And 'escalated' would flip
    -- the queue to 'escalated', which review_moderation_item rejects (it requires
    -- 'pending'). Mirror publish_agent: just audit and return — the item stays
    -- reviewable by an admin via review_moderation_item.
    INSERT INTO audit_journal(user_id, action, metadata)
    VALUES (
      v_caller_id,
      'RULE_APPROVAL_ESCALATED',
      jsonb_build_object(
        'severity', 'critical',
        'queue_id', v_queue_id,
        'rule_id', p_rule_id,
        'reason', 'AISHA evaluation unavailable — awaiting manual review',
        'error', SQLERRM
      )
    );
    RETURN jsonb_build_object(
      'status', 'pending_review',
      'queue_id', v_queue_id,
      'message', 'AISHA evaluation unavailable — awaiting manual review'
    );
  END;

  RETURN jsonb_build_object(
    'status', 'review',
    'queue_id', v_queue_id,
    'message', 'Submitted for AISHA compliance review'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.publish_expert_rule(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_expert_rule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_expert_rule(uuid) TO service_role;
