-- Function: audience_process_signal_audited

CREATE OR REPLACE FUNCTION public.audience_process_signal_audited(p_event_id uuid, p_extra_tags text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event public.integration_events%ROWTYPE;
  v_rule public.signal_tag_rules%ROWTYPE;
  v_applied_tags TEXT[] := p_extra_tags;
  v_actor_id UUID;
BEGIN
  -- Load event
  SELECT * INTO v_event FROM public.integration_events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event % not found', p_event_id;
  END IF;

  -- Resolve actor from event payload (heuristics)
  v_actor_id := COALESCE(
    (v_event.metadata->>'user_id')::uuid,
    (v_event.metadata->>'actor_user_id')::uuid,
    (v_event.metadata->>'profile_id')::uuid
  );

  -- Apply matching rules
  FOR v_rule IN
    SELECT tags FROM public.signal_tag_rules
    WHERE is_active = true
      AND v_event.event_type ~ event_type_pattern
      AND (source_pattern IS NULL OR v_event.event_source ~ source_pattern)
    ORDER BY priority ASC
  LOOP
    v_applied_tags := array_cat(v_applied_tags, v_rule.tags);
  END LOOP;

  -- Dedupe tags
  v_applied_tags := ARRAY(SELECT DISTINCT unnest(v_applied_tags));

  -- Apply as polymorphic tags on the actor (if resolved)
  IF v_actor_id IS NOT NULL AND array_length(v_applied_tags, 1) > 0 THEN
    INSERT INTO public.story_labels (label, resource_type, resource_id, story_id)
    SELECT tag, 'actor', v_actor_id, NULL
    FROM unnest(v_applied_tags) tag
    ON CONFLICT DO NOTHING;
  END IF;

  -- Audit
  PERFORM public.audience_log_event(
    'process',
    'process_signal',
    'integration_event',
    p_event_id,
    'Auto-tagged signal',
    jsonb_build_object('actor_id', v_actor_id, 'tags', v_applied_tags, 'rule_count', array_length(v_applied_tags, 1))
  );

  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'actor_id', v_actor_id,
    'tags_applied', v_applied_tags,
    'tag_count', COALESCE(array_length(v_applied_tags, 1), 0)
  );
END;
$function$

;

REVOKE ALL ON FUNCTION audience_process_signal_audited(uuid,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_process_signal_audited(uuid,text[]) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_process_signal_audited(uuid,text[]) TO service_role;
