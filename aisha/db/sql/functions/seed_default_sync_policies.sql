-- Function: public.seed_default_sync_policies
-- Arguments: p_story_id uuid
-- Description: Seeds default sync policies for a story based on the 3-class data model.
-- Security: SECURITY DEFINER — admin/staff only

CREATE OR REPLACE FUNCTION public.seed_default_sync_policies(p_story_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_count integer := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff role required';
  END IF;

  INSERT INTO story_sync_policies (story_id, data_domain, data_class, flow_direction, description)
  VALUES
    (p_story_id, 'story_metadata', 'canonical_portable', 'downstream_only',
     'Story title, status, tech_stack, domain, project_preview'),
    (p_story_id, 'rulesets', 'canonical_portable', 'downstream_only',
     'Expert rules and ruleset fingerprints'),
    (p_story_id, 'knowledge_items', 'canonical_portable', 'promote_on_approval',
     'Knowledge items content — local additions can be promoted upstream'),
    (p_story_id, 'build_config', 'canonical_portable', 'downstream_only',
     'Portable build configuration shared across instances'),
    (p_story_id, 'sync_policies', 'canonical_portable', 'downstream_only',
     'Sync policy definitions themselves'),
    (p_story_id, 'embeddings', 'derived_reproducible', 'no_sync',
     'Vector embeddings — rebuilt locally from knowledge items'),
    (p_story_id, 'knowledge_chunks', 'derived_reproducible', 'no_sync',
     'Chunked text for RAG — rebuilt locally'),
    (p_story_id, 'audit_journal', 'sovereign_local', 'local_only',
     'Audit log — never leaves the instance'),
    (p_story_id, 'ai_trace_events', 'sovereign_local', 'local_only',
     'AI agent traces and session logs'),
    (p_story_id, 'endpoint_bindings', 'sovereign_local', 'local_only',
     'Instance-specific endpoint URLs and auth refs'),
    (p_story_id, 'sessions', 'sovereign_local', 'local_only',
     'AISHA session state — workspace-specific'),
    (p_story_id, 'story_entries', 'sovereign_local', 'local_only',
     'Timeline/discussion entries never leave the instance')
  ON CONFLICT (story_id, data_domain) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'story_id', p_story_id,
    'policies_created', v_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.seed_default_sync_policies(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_default_sync_policies(uuid) TO authenticated;
