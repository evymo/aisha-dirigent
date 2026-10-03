-- Function: public.set_agent_knowledge_binding_audited
-- Description: Idempotent upsert for an agent ↔ expert_rule binding.
--   Creates a new row when no active matching binding exists, otherwise
--   updates priority / version / notes / is_active in place. Writes an
--   audit_journal entry on every mutation (action_type='update'/'create').
-- Security: SECURITY DEFINER. Admin/staff only.

CREATE OR REPLACE FUNCTION public.set_agent_knowledge_binding_audited(
  p_agent_slug        text,
  p_knowledge_item_id uuid,
  p_binding_type      text DEFAULT 'rule',
  p_priority          int  DEFAULT 100,
  p_version           int  DEFAULT NULL,
  p_is_active         boolean DEFAULT true,
  p_story_id          uuid DEFAULT NULL,
  p_notes             text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id   uuid := auth.uid();
  v_binding_id uuid;
  v_existing_id uuid;
  v_existing_priority int;
  v_existing_version int;
  v_existing_notes text;
  v_existing_active boolean;
  v_action_type public.journal_action_type;
BEGIN
  IF v_user_id IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Admin or staff role required to manage bindings'
      USING ERRCODE = '42501';
  END IF;

  -- Validate FK: expert_rules row must exist.
  IF NOT EXISTS (SELECT 1 FROM public.expert_rules WHERE id = p_knowledge_item_id) THEN
    RAISE EXCEPTION 'Expert rule not found: %', p_knowledge_item_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Validate story FK when scoped (NULL = global, always OK).
  IF p_story_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.partner_stories WHERE id = p_story_id)
  THEN
    RAISE EXCEPTION 'Story not found: %', p_story_id USING ERRCODE = 'P0002';
  END IF;

  -- Look for an existing matching binding (active or inactive).
  SELECT akb.id, akb.priority, akb.version, akb.notes, akb.is_active
    INTO v_existing_id, v_existing_priority, v_existing_version,
         v_existing_notes, v_existing_active
  FROM public.agent_knowledge_bindings akb
  WHERE akb.agent_slug         = p_agent_slug
    AND akb.knowledge_item_id  = p_knowledge_item_id
    AND akb.binding_type       = p_binding_type
    AND akb.story_id IS NOT DISTINCT FROM p_story_id
  ORDER BY akb.is_active DESC, akb.updated_at DESC
  LIMIT 1;

  IF v_existing_id IS NULL THEN
    INSERT INTO public.agent_knowledge_bindings (
      agent_slug, knowledge_item_id, binding_type, priority,
      version, is_active, story_id, notes, created_by
    ) VALUES (
      p_agent_slug, p_knowledge_item_id, p_binding_type, p_priority,
      p_version, p_is_active, p_story_id, p_notes, v_user_id
    )
    RETURNING id INTO v_binding_id;
    v_action_type := 'create'::public.journal_action_type;
  ELSE
    UPDATE public.agent_knowledge_bindings
       SET priority   = p_priority,
           version    = p_version,
           is_active  = p_is_active,
           notes      = p_notes,
           updated_at = now()
     WHERE id = v_existing_id
    RETURNING id INTO v_binding_id;
    v_action_type := 'update'::public.journal_action_type;
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := v_action_type,
    p_area        := 'admin'::public.journal_area,
    p_details     := jsonb_build_object(
      'agent_slug',        p_agent_slug,
      'knowledge_item_id', p_knowledge_item_id,
      'binding_type',      p_binding_type,
      'priority',          p_priority,
      'version',           p_version,
      'is_active',         p_is_active,
      'story_id',          p_story_id
    ),
    p_entity_id   := v_binding_id::text,
    p_entity_type := 'agent_knowledge_bindings',
    p_new_values  := jsonb_build_object(
      'priority',   p_priority,
      'is_active',  p_is_active,
      'notes',      p_notes
    ),
    p_old_values  := CASE
      WHEN v_existing_id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'priority',  v_existing_priority,
        'is_active', v_existing_active,
        'notes',     v_existing_notes
      )
    END,
    p_severity    := 'info'::public.journal_severity,
    p_summary     := format(
      '%s agent_knowledge_binding (%s ↔ %s, %s)',
      CASE WHEN v_existing_id IS NULL THEN 'Created' ELSE 'Updated' END,
      p_agent_slug, p_knowledge_item_id, p_binding_type
    ),
    p_user_id     := v_user_id
  );

  RETURN v_binding_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_agent_knowledge_binding_audited(
  text, uuid, text, int, int, boolean, uuid, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_agent_knowledge_binding_audited(
  text, uuid, text, int, int, boolean, uuid, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_agent_knowledge_binding_audited(
  text, uuid, text, int, int, boolean, uuid, text
) TO service_role;
