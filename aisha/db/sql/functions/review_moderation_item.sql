-- Function: public.review_moderation_item
-- Description: Updates moderation queue status and the underlying resource.
-- Security: SECURITY DEFINER - admin only.
-- @category: ADMIN
-- @audit: true

CREATE OR REPLACE FUNCTION public.review_moderation_item(
  p_decision text,
  p_notes text DEFAULT NULL,
  p_queue_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_resource_type text;
  v_resource_id uuid;
  v_current_status text;
BEGIN
  -- 1. Check permissions
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'staff') THEN
    RAISE EXCEPTION 'Access denied. Admin or Staff role required.';
  END IF;

  -- 2. Get Item Details
  SELECT resource_type, resource_id, status INTO v_resource_type, v_resource_id, v_current_status
  FROM knowledge_moderation_queue
  WHERE id = p_queue_id;

  IF v_resource_type IS NULL THEN
    RAISE EXCEPTION 'Moderation item not found.';
  END IF;
  
  -- 'escalated' is the state AISHA sets when it defers to a human, so the
  -- human-review RPC MUST accept it — otherwise an escalated agent/rule is
  -- frozen forever (queue 'escalated', resource stuck in 'reviewing'). Only a
  -- terminal decision (approved/rejected) blocks re-review.
  IF v_current_status NOT IN ('pending', 'escalated') THEN
    RAISE EXCEPTION 'Item already reviewed (status: %).', v_current_status;
  END IF;

  -- 3. Update Queue Item
  UPDATE knowledge_moderation_queue
  SET
    status = p_decision,
    reviewer_user_id = auth.uid(),
    reviewer_notes = p_notes,
    updated_at = now()
  WHERE id = p_queue_id;

  -- 4. Update Resource Status
  IF v_resource_type = 'post' THEN
    IF p_decision = 'approved' THEN
      UPDATE knowledge_posts SET status = 'visible' WHERE id = v_resource_id;
    ELSE -- rejected
      UPDATE knowledge_posts SET status = 'hidden' WHERE id = v_resource_id;
    END IF;

  ELSIF v_resource_type = 'expert_rule' THEN
    -- Was previously stranded: escalated/queued expert_rules had no human-review
    -- resolution path. approve → published, reject → draft (author can re-publish).
    IF p_decision = 'approved' THEN
      UPDATE expert_rules
         SET status = 'published',
             published_at = COALESCE(published_at, now()),
             updated_at = now()
       WHERE id = v_resource_id;
    ELSE -- rejected
      UPDATE expert_rules SET status = 'draft', updated_at = now() WHERE id = v_resource_id;
    END IF;

  ELSIF v_resource_type = 'agent' THEN
    -- Marketplace agent: resource_id = plugin_catalog.id.
    IF p_decision = 'approved' THEN
      UPDATE plugin_catalog
         SET status = 'canary'::plugin_status, updated_at = now()
       WHERE id = v_resource_id
         AND status NOT IN ('disabled'::plugin_status, 'archived'::plugin_status);
      -- Materialize only if the guarded UPDATE promoted the plugin — never
      -- re-activate a disabled/archived agent's runtime on a late human approval
      -- (mirrors fn_aisha_kb_decision; protects the kill-switch).
      IF FOUND THEN
        -- Kind dispatcher (mirrors fn_aisha_kb_decision).
        PERFORM public.materialize_plugin(v_resource_id);
      END IF;
    ELSE -- rejected
      UPDATE plugin_catalog
         SET status = 'submitted'::plugin_status, updated_at = now()
       WHERE id = v_resource_id;
    END IF;
  END IF;

  -- 5. Audit
  -- Direct insert mirrors fn_aisha_kb_decision (action is free text on
  -- audit_journal). The previous write_audit_journal call passed
  -- 'REVIEW_MODERATION_ITEM' as a journal_action_type enum value — which is not a
  -- member of that curated verb vocabulary — so the audit RAISEd for every
  -- decision (a latent, untested bug). Fixed at source.
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'REVIEW_MODERATION_ITEM',
    jsonb_build_object(
      'area', 'knowledge',
      'severity', 'info',
      'queue_id', p_queue_id,
      'decision', p_decision,
      'notes', p_notes,
      'resource_type', v_resource_type,
      'resource_id', v_resource_id
    )
  );
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.review_moderation_item(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_moderation_item(text, text, uuid) TO authenticated;
