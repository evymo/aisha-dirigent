-- Function: transition_story_delivery_status

CREATE OR REPLACE FUNCTION public.transition_story_delivery_status(p_story_id uuid, p_new_status text, p_trigger_source text DEFAULT 'manual'::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_status text;
  v_transition_rule RECORD;
  v_user_id uuid := auth.uid();
  v_transition_id uuid;
BEGIN
  -- 0. Stráž (can_access_story.sql) — PŘED dohledáním, ať cizí a neexistující story vypadají stejně.
  IF NOT public.can_access_story(p_story_id, true) THEN
    RAISE EXCEPTION 'Access denied to story %', p_story_id USING ERRCODE = '42501';
  END IF;

  -- 1. Get current delivery_status
  SELECT delivery_status INTO v_current_status
  FROM partner_stories
  WHERE id = p_story_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Story not found: %', p_story_id USING ERRCODE = 'P0002';
  END IF;

  -- 2. Check if transition is allowed
  SELECT * INTO v_transition_rule
  FROM delivery_transition_rules
  WHERE is_active = true
    AND (from_status IS NOT DISTINCT FROM v_current_status)
    AND to_status = p_new_status;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Transition from %s to %s is not allowed',
        COALESCE(v_current_status, 'NULL'), p_new_status),
      'current_status', v_current_status
    );
  END IF;

  -- 3. Check role requirement
  IF v_transition_rule.requires_role IS NOT NULL THEN
    IF NOT is_admin_or_staff() THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', format('Transition to %s requires role: %s', p_new_status, v_transition_rule.requires_role),
        'current_status', v_current_status
      );
    END IF;
  END IF;

  -- 4. Update delivery_status
  UPDATE partner_stories
  SET delivery_status = p_new_status,
      updated_at = now()
  WHERE id = p_story_id;

  -- 5. Record transition
  INSERT INTO delivery_transitions (story_id, from_status, to_status, triggered_by, trigger_source, metadata)
  VALUES (p_story_id, v_current_status, p_new_status, v_user_id, p_trigger_source, p_metadata)
  RETURNING id INTO v_transition_id;

  -- 6. Audit
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'DELIVERY_STATUS_TRANSITION',
    jsonb_build_object(
      'area', 'delivery',
      'severity', 'info',
      'story_id', p_story_id,
      'from_status', v_current_status,
      'to_status', p_new_status,
      'trigger_source', p_trigger_source,
      'transition_id', v_transition_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'transition_id', v_transition_id,
    'from_status', v_current_status,
    'to_status', p_new_status,
    'story_id', p_story_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION transition_story_delivery_status(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transition_story_delivery_status(uuid,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION transition_story_delivery_status(uuid,text,text,jsonb) TO service_role;
