-- Function: public.register_story_instance
-- Arguments: p_instance_label text, p_instance_type text, p_is_origin boolean, p_story_id uuid
-- Description: Registers a new instance (environment) for a story.
-- Security: SECURITY DEFINER — admin/staff only

CREATE OR REPLACE FUNCTION public.register_story_instance(
  p_instance_label text,
  p_instance_type text,
  p_is_origin boolean DEFAULT false,
  p_story_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_instance_id uuid;
  v_resolved_story_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff role required';
  END IF;

  v_resolved_story_id := p_story_id;

  IF p_is_origin AND EXISTS (
    SELECT 1 FROM story_instances
    WHERE story_id = v_resolved_story_id AND is_origin = true
  ) THEN
    RAISE EXCEPTION 'Origin instance already exists for story %', v_resolved_story_id;
  END IF;

  INSERT INTO story_instances (
    story_id, instance_label, instance_type, is_origin
  ) VALUES (
    v_resolved_story_id, p_instance_label, p_instance_type, p_is_origin
  ) RETURNING id INTO v_instance_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (v_user_id, 'STORY_INSTANCE_REGISTER', jsonb_build_object(
    'area', 'story_sync', 'severity', 'info',
    'entity_type', 'story_instance', 'entity_id', v_instance_id,
    'story_id', v_resolved_story_id,
    'instance_type', p_instance_type, 'is_origin', p_is_origin
  ));

  RETURN jsonb_build_object(
    'instance_id', v_instance_id,
    'story_id', v_resolved_story_id,
    'instance_label', p_instance_label,
    'instance_type', p_instance_type,
    'is_origin', p_is_origin
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.register_story_instance(text, text, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_story_instance(text, text, boolean, uuid) TO authenticated;
