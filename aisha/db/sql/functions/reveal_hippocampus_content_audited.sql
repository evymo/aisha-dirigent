-- Function: public.reveal_hippocampus_content_audited
-- Description: Returns the full (unmasked) content of a hippocampus
--   memory row. Every reveal is recorded in audit_journal with action
--   'access' + tag 'pii_reveal' so reveals are forensically traceable.
-- Security: SECURITY DEFINER. Admin/staff only — participants can see
--   masked preview via list_hippocampus_signals; full reveal is an
--   admin-only operation.

CREATE OR REPLACE FUNCTION public.reveal_hippocampus_content_audited(
  p_memory_id uuid,
  p_reason    text DEFAULT NULL
)
RETURNS TABLE (
  memory_id    uuid,
  agent_slug   text,
  memory_type  text,
  content      text,
  importance   int,
  expires_at   timestamptz,
  created_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_agent_slug text;
BEGIN
  IF v_user_id IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Admin or staff role required for hippocampus content reveal'
      USING ERRCODE = '42501';
  END IF;

  SELECT am.agent_slug INTO v_agent_slug
  FROM public.agent_memories am
  WHERE am.id = p_memory_id;

  IF v_agent_slug IS NULL THEN
    RAISE EXCEPTION 'Memory not found: %', p_memory_id USING ERRCODE = 'P0002';
  END IF;

  IF v_agent_slug NOT LIKE 'hippocampus:%' THEN
    RAISE EXCEPTION 'Memory % is not a hippocampus signal (agent_slug=%)',
      p_memory_id, v_agent_slug USING ERRCODE = '22023';
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := 'access'::public.journal_action_type,
    p_area        := 'admin'::public.journal_area,
    p_details     := jsonb_build_object(
      'memory_id', p_memory_id,
      'agent_slug', v_agent_slug,
      'reason', COALESCE(p_reason, '(no reason provided)')
    ),
    p_entity_id   := p_memory_id::text,
    p_entity_type := 'agent_memories',
    p_new_values  := NULL,
    p_old_values  := NULL,
    p_severity    := 'notice'::public.journal_severity,
    p_summary     := format(
      'Hippocampus content reveal — memory_id=%s, agent=%s',
      p_memory_id, v_agent_slug
    ),
    p_tags        := ARRAY['pii_reveal', 'hippocampus'],
    p_user_id     := v_user_id
  );

  RETURN QUERY
  SELECT am.id, am.agent_slug, am.memory_type, am.content,
         am.importance, am.expires_at, am.created_at
  FROM public.agent_memories am
  WHERE am.id = p_memory_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reveal_hippocampus_content_audited(uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reveal_hippocampus_content_audited(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.reveal_hippocampus_content_audited(uuid, text)
  TO service_role;
