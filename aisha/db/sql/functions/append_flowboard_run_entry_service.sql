-- Function: public.append_flowboard_run_entry_service
-- Per-node Flowboard run provenance from the n8n engine. The n8n execution callback
-- (svc-ai-chat /flowboard-n8n-callback) calls this per executed node to append an
-- automation_step story_entry — the SAME iconographic StoryLoop timeline as the sandbox
-- engine, just written from a service context (n8n carries no auth.uid()).
--
-- Mirrors append_inbound_comm_entry_audited (service-role-only story_entries writer) but
-- for flowboard run steps: owner-attributed (created_by = the flow owner, validated) and
-- idempotent by (run_id, node_id) so an n8n callback retry never double-writes.
--
-- Security: SECURITY DEFINER, service_role ONLY. @audit: required
CREATE OR REPLACE FUNCTION public.append_flowboard_run_entry_service(
  p_story_id   uuid,
  p_owner_id   uuid,
  p_run_id     text,
  p_node_id    text,
  p_entry_type text,
  p_content    text,
  p_metadata   jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing uuid;
  v_entry_id uuid;
BEGIN
  -- service-role only: the n8n execution callback carries no auth.uid().
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'append_flowboard_run_entry_service is service-role only' USING ERRCODE = '42501';
  END IF;
  -- defense in depth: the owner must really own the run's story.
  IF NOT EXISTS (SELECT 1 FROM public.partner_stories WHERE id = p_story_id AND user_id = p_owner_id) THEN
    RAISE EXCEPTION 'owner % does not own story %', p_owner_id, p_story_id USING ERRCODE = '42501';
  END IF;
  -- idempotency: same (run_id, node_id) already recorded → return it (callback retry-safe).
  SELECT id INTO v_existing
    FROM public.story_entries
   WHERE story_id = p_story_id
     AND entry_type = p_entry_type
     AND metadata->'flowboard'->>'runId' = p_run_id
     AND metadata->'flowboard'->>'nodeId' = p_node_id
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('entry_id', v_existing, 'deduped', true);
  END IF;

  INSERT INTO public.story_entries (story_id, entry_type, content, metadata, is_internal, created_by)
  VALUES (p_story_id, p_entry_type, p_content, COALESCE(p_metadata, '{}'::jsonb), false, p_owner_id)
  RETURNING id INTO v_entry_id;

  UPDATE public.partner_stories SET last_activity_at = now() WHERE id = p_story_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (p_owner_id, 'FLOWBOARD_N8N_STEP',
    jsonb_build_object('area','flowboard','severity','info','entity_type','story_entries',
      'entity_id',v_entry_id,'story_id',p_story_id,'run_id',p_run_id,'node_id',p_node_id));

  RETURN jsonb_build_object('entry_id', v_entry_id, 'deduped', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.append_flowboard_run_entry_service(uuid, uuid, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.append_flowboard_run_entry_service(uuid, uuid, text, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.append_flowboard_run_entry_service(uuid, uuid, text, text, text, text, jsonb) TO service_role;
