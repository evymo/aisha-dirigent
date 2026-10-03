-- Function: public.set_memory_governance_audited
-- Description: Governance mutations on a hippocampus memory row. Three
--   modes: 'promote' (importance=10), 'forget' (expires_at=now()),
--   'suspend' (importance=0). Every mutation is audit-journaled.
-- Security: SECURITY DEFINER, admin/staff only.

CREATE OR REPLACE FUNCTION public.set_memory_governance_audited(
  p_memory_id uuid,
  p_mode      text,   -- 'promote' | 'forget' | 'suspend'
  p_reason    text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_old_importance int;
  v_old_expires_at timestamptz;
  v_new_importance int;
  v_new_expires_at timestamptz;
  v_agent_slug text;
BEGIN
  IF v_user_id IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Admin or staff role required to govern hippocampus memories'
      USING ERRCODE = '42501';
  END IF;

  IF p_mode NOT IN ('promote', 'forget', 'suspend') THEN
    RAISE EXCEPTION USING
      MESSAGE = format('Invalid mode: %s (expected promote|forget|suspend)', p_mode),
      ERRCODE = '22023';
  END IF;

  SELECT am.importance, am.expires_at, am.agent_slug
    INTO v_old_importance, v_old_expires_at, v_agent_slug
  FROM public.agent_memories am
  WHERE am.id = p_memory_id;

  IF v_agent_slug IS NULL THEN
    RAISE EXCEPTION 'Memory not found: %', p_memory_id USING ERRCODE = 'P0002';
  END IF;

  IF v_agent_slug NOT LIKE 'hippocampus:%' THEN
    RAISE EXCEPTION 'Memory % is not a hippocampus signal (agent_slug=%)',
      p_memory_id, v_agent_slug USING ERRCODE = '22023';
  END IF;

  v_new_importance := v_old_importance;
  v_new_expires_at := v_old_expires_at;

  IF p_mode = 'promote' THEN
    v_new_importance := 10;
  ELSIF p_mode = 'forget' THEN
    v_new_expires_at := now();
  ELSIF p_mode = 'suspend' THEN
    v_new_importance := 0;
  END IF;

  UPDATE public.agent_memories
     SET importance = v_new_importance,
         expires_at = v_new_expires_at,
         updated_at = now()
   WHERE id = p_memory_id;

  PERFORM public.write_audit_journal(
    p_action_type := 'update'::public.journal_action_type,
    p_area        := 'admin'::public.journal_area,
    p_details     := jsonb_build_object(
      'memory_id',  p_memory_id,
      'agent_slug', v_agent_slug,
      'mode',       p_mode,
      'reason',     COALESCE(p_reason, '(no reason provided)')
    ),
    p_entity_id   := p_memory_id::text,
    p_entity_type := 'agent_memories',
    p_new_values  := jsonb_build_object(
      'importance', v_new_importance,
      'expires_at', v_new_expires_at
    ),
    p_old_values  := jsonb_build_object(
      'importance', v_old_importance,
      'expires_at', v_old_expires_at
    ),
    p_severity    := 'info'::public.journal_severity,
    p_summary     := format(
      'Hippocampus memory governance — %s (memory_id=%s)',
      p_mode, p_memory_id
    ),
    p_tags        := ARRAY['hippocampus', 'governance', p_mode],
    p_user_id     := v_user_id
  );

  RETURN p_memory_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_memory_governance_audited(uuid, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_memory_governance_audited(uuid, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_memory_governance_audited(uuid, text, text)
  TO service_role;
