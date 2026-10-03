-- Function: public.fn_aisha_kb_decision
-- Arguments: p_queue_id uuid, p_decision text, p_evaluation jsonb, p_notes text
-- Returns: jsonb
-- Security: SECURITY DEFINER — service_role only
-- Description: Called by n8n (WF_KB_COMPLIANCE_GATE) after AISHA evaluates
--   a proposed KB change. Applies the decision: approve → publish,
--   reject → revert to draft, escalate → keep in review for human.

CREATE OR REPLACE FUNCTION public.fn_aisha_kb_decision(
  p_queue_id    uuid,
  p_decision    text,            -- 'approved' | 'rejected' | 'escalated'
  p_evaluation  jsonb DEFAULT '{}'::jsonb,
  p_notes       text DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_resource_type text;
  v_resource_id   uuid;
  v_current       text;
  v_auto          boolean;
  v_audit_user_id uuid;
BEGIN
  -- Validate decision
  IF p_decision NOT IN ('approved', 'rejected', 'escalated') THEN
    RAISE EXCEPTION USING MESSAGE = format('Invalid decision: %s. Must be approved, rejected, or escalated.', p_decision), ERRCODE = '22023';
  END IF;

  -- Get moderation queue item
  SELECT resource_type, resource_id, status, auto_decision
    INTO v_resource_type, v_resource_id, v_current, v_auto
    FROM knowledge_moderation_queue
   WHERE id = p_queue_id;

  IF v_resource_type IS NULL THEN
    RAISE EXCEPTION 'Moderation queue item not found: %', p_queue_id;
  END IF;

  IF v_current != 'pending' THEN
    RAISE EXCEPTION 'Item already decided (status: %)', v_current;
  END IF;

  -- Update moderation queue
  UPDATE knowledge_moderation_queue
     SET status = p_decision,
         aisha_evaluation = p_evaluation,
         auto_decision = (p_evaluation->>'auto')::boolean IS TRUE,
         reviewer_notes = p_notes,
         reviewer_user_id = auth.uid(),
         updated_at = now()
   WHERE id = p_queue_id;

  -- Apply decision to the resource
  IF v_resource_type = 'expert_rule' THEN
    IF p_decision = 'approved' THEN
      UPDATE expert_rules
         SET status = 'published',
             published_at = COALESCE(published_at, now()),
             updated_at = now()
       WHERE id = v_resource_id;
    ELSIF p_decision = 'rejected' THEN
      UPDATE expert_rules
         SET status = 'draft',
             updated_at = now()
       WHERE id = v_resource_id;
    END IF;
    -- 'escalated' keeps status='review' for human decision

  ELSIF v_resource_type = 'post' THEN
    -- Existing behavior for knowledge posts
    IF p_decision = 'approved' THEN
      UPDATE knowledge_posts SET status = 'visible' WHERE id = v_resource_id;
    ELSIF p_decision = 'rejected' THEN
      UPDATE knowledge_posts SET status = 'hidden' WHERE id = v_resource_id;
    END IF;

  ELSIF v_resource_type = 'agent' THEN
    -- Marketplace agent: resource_id = plugin_catalog.id.
    -- approve → 'canary' (first listing-visible status; promotion canary→ga is a
    --           later health-watch concern). reject → 'submitted' (the author can
    --           amend agent_spec and re-publish, mirroring expert_rule→draft).
    IF p_decision = 'approved' THEN
      UPDATE plugin_catalog
         SET status = 'canary'::plugin_status,
             updated_at = now()
       WHERE id = v_resource_id
         AND status NOT IN ('disabled'::plugin_status, 'archived'::plugin_status);
      -- ONLY materialize if the guarded UPDATE actually promoted the plugin.
      -- A disabled/archived plugin is excluded by the WHERE above; without this
      -- guard a delayed/replayed 'approved' decision would still re-activate its
      -- agent_catalog row (is_active=true) and defeat the operator kill-switch.
      IF FOUND THEN
        -- Kind dispatcher: any plugin kind materializes into its registry
        -- (agents keep their path inside materialize_plugin).
        PERFORM public.materialize_plugin(v_resource_id);
      END IF;
    ELSIF p_decision = 'rejected' THEN
      UPDATE plugin_catalog
         SET status = 'submitted'::plugin_status,
             updated_at = now()
       WHERE id = v_resource_id;
    END IF;
    -- 'escalated' keeps status='reviewing' for human decision
  END IF;

  -- Resolve audit user: prefer auth.uid() (human reviewer), fallback to resource author
  v_audit_user_id := auth.uid();
  IF v_audit_user_id IS NULL AND v_resource_type = 'expert_rule' THEN
    SELECT pp.user_id INTO v_audit_user_id
      FROM expert_rules er
      JOIN partner_profiles pp ON pp.id = er.author_partner_id
     WHERE er.id = v_resource_id;
  ELSIF v_audit_user_id IS NULL AND v_resource_type = 'agent' THEN
    SELECT pp.user_id INTO v_audit_user_id
      FROM plugin_catalog pc
      JOIN partner_profiles pp ON pp.id = pc.author_partner_id
     WHERE pc.id = v_resource_id;
  END IF;

  -- Audit (skip if no valid user_id to avoid FK violation)
  IF v_audit_user_id IS NOT NULL THEN
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_audit_user_id,
    'AISHA_KB_DECISION',
    jsonb_build_object(
      'area', 'knowledge',
      'severity', CASE p_decision
        WHEN 'rejected' THEN 'warning'
        WHEN 'escalated' THEN 'warning'
        ELSE 'info'
      END,
      'queue_id', p_queue_id,
      'resource_type', v_resource_type,
      'resource_id', v_resource_id,
      'decision', p_decision,
      'auto_decision', (p_evaluation->>'auto')::boolean IS TRUE,
      'evaluation_summary', p_evaluation->>'reason'
    )
  );
  END IF;

  RETURN jsonb_build_object(
    'decision', p_decision,
    'resource_type', v_resource_type,
    'resource_id', v_resource_id,
    'queue_id', p_queue_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_aisha_kb_decision(uuid, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_aisha_kb_decision(uuid, text, jsonb, text) TO service_role;
