-- Function: public.export_story_bundle
-- Arguments: p_story_id uuid, p_instance_token text DEFAULT NULL, p_source_instance_id uuid DEFAULT NULL
-- Description: Exports canonical portable data from a story into a versioned bundle.
--              Collects story metadata, rulesets (incl. ai_instructions since 1.1.0),
--              knowledge items, sync policies, and portable config into a single
--              manifest. Computes SHA-256 manifest hash for integrity verification
--              on import. Two auth modes:
--                1. Role-based (UI export): no token, requires auth.uid() + admin/staff
--                2. Token-based (M2M sync): instance token validated via
--                   validate_sync_authorization; auth.uid() MAY be NULL. Domains
--                   blocked by sync policies (flow_direction = local_only) are
--                   emptied in the manifest and reported as skipped_domains.
-- Security: SECURITY DEFINER — admin/staff or valid instance token

-- Drop legacy 1-arg overload (replaced by 3-arg with token auth)
DROP FUNCTION IF EXISTS public.export_story_bundle(uuid);

CREATE OR REPLACE FUNCTION public.export_story_bundle(
  p_story_id uuid,
  p_instance_token text DEFAULT NULL,
  p_source_instance_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_id uuid;
  v_story record;
  v_ruleset record;
  v_context record;
  v_origin_instance record;
  v_next_version integer;
  v_bundle_id uuid;
  v_operation_id uuid;
  v_portable_manifest jsonb;
  v_artifact_summary jsonb;
  v_knowledge_items jsonb;
  v_sync_policies jsonb;
  v_expert_rules jsonb;
  v_ruleset_section jsonb;
  v_story_metadata jsonb;
  v_build_config jsonb;
  v_manifest_hash text;
  v_auth_result jsonb;
  v_blocked_domains jsonb := '[]'::jsonb;
  v_skipped_domains text[] := '{}';
  v_actor_ref text;
  v_actor_type text;
  v_metadata_blocked boolean := false;
  v_rules_blocked boolean := false;
  v_knowledge_blocked boolean := false;
  v_build_blocked boolean := false;
BEGIN
  v_user_id := auth.uid();

  -- ===== AUTHORIZATION =====
  -- Token-based (M2M sync): auth.uid() MAY be NULL, instance token is validated.
  -- Role-based (UI export): auth.uid() + admin/staff required, nothing blocked.
  IF p_instance_token IS NOT NULL THEN
    IF p_source_instance_id IS NULL THEN
      RAISE EXCEPTION 'Source instance id required for token-based export' USING ERRCODE = '22023';
    END IF;

    v_auth_result := public.validate_sync_authorization(
      p_source_instance_id, p_instance_token, 'export', p_story_id
    );

    IF NOT (v_auth_result->>'authorized')::boolean THEN
      -- user_id may be NULL (M2M actor) — FK-safe, see validate_sync_authorization
      INSERT INTO audit_journal (user_id, action, metadata)
      VALUES (v_user_id, 'SYNC_EXPORT_DENIED', jsonb_build_object(
        'area', 'story_sync', 'severity', 'warning',
        'story_id', p_story_id,
        'source_instance_id', p_source_instance_id,
        'reason', v_auth_result->>'reason'
      ));

      RETURN jsonb_build_object(
        'status', 'denied',
        'reason', v_auth_result->>'reason'
      );
    END IF;

    v_blocked_domains := COALESCE(v_auth_result->'blocked_domains', '[]'::jsonb);
    v_actor_type := 'instance';
    v_actor_ref := 'instance:' || p_source_instance_id;
  ELSE
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Only admin/staff can export without a token; nothing is blocked for admins
    IF NOT public.is_admin_or_staff() THEN
      RAISE EXCEPTION 'Unauthorized: admin or staff role required';
    END IF;

    v_actor_type := 'human';
    v_actor_ref := v_user_id::text;
  END IF;

  -- Resolve blocked manifest sections from sync policy domains
  v_metadata_blocked := EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_blocked_domains) bd
    WHERE bd->>'data_domain' = 'story_metadata' AND (bd->>'blocked')::boolean
  );
  v_rules_blocked := EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_blocked_domains) bd
    WHERE bd->>'data_domain' = 'rulesets' AND (bd->>'blocked')::boolean
  );
  v_knowledge_blocked := EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_blocked_domains) bd
    WHERE bd->>'data_domain' = 'knowledge_items' AND (bd->>'blocked')::boolean
  );
  v_build_blocked := EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_blocked_domains) bd
    WHERE bd->>'data_domain' = 'build_config' AND (bd->>'blocked')::boolean
  );

  -- Load story
  SELECT * INTO v_story
  FROM partner_stories
  WHERE id = p_story_id;

  IF v_story.id IS NULL THEN
    RAISE EXCEPTION 'Story not found: %', p_story_id;
  END IF;

  -- Resolve origin instance — MUST exist for export
  SELECT * INTO v_origin_instance
  FROM story_instances
  WHERE story_id = p_story_id AND is_origin = true;

  IF v_origin_instance.id IS NULL THEN
    RAISE EXCEPTION 'No origin instance registered for story %. Register one first.', p_story_id;
  END IF;

  -- Load current ruleset
  SELECT * INTO v_ruleset
  FROM story_rulesets sr
  JOIN story_contexts sc ON sc.ruleset_id = sr.id
  WHERE sc.story_id = p_story_id;

  -- Load story context
  SELECT * INTO v_context
  FROM story_contexts
  WHERE story_id = p_story_id;

  -- Serialize concurrent exports of the same story (tx-scoped advisory lock)
  -- so MAX(bundle_version)+1 cannot race into a duplicate version
  PERFORM pg_advisory_xact_lock(hashtext('story_bundle_export'), hashtext(p_story_id::text));

  -- Calculate next bundle version
  SELECT COALESCE(MAX(bundle_version), 0) + 1 INTO v_next_version
  FROM story_bundles
  WHERE story_id = p_story_id;

  -- Collect portable knowledge items (content + metadata, not embeddings).
  -- Manifest keys map to columns: slug→source_slug, content→body_markdown,
  -- tags→ai_context_tags, verified→is_verified. metadata carries the fields
  -- import needs to re-insert the row (item_type is NOT NULL enum).
  IF v_knowledge_blocked THEN
    v_knowledge_items := '[]'::jsonb;
    v_skipped_domains := v_skipped_domains || 'knowledge_items'::text;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', ki.id,
      'title', ki.title,
      'slug', ki.source_slug,
      'content', ki.body_markdown,
      'category', ki.category,
      'tags', ki.ai_context_tags,
      'status', ki.status,
      'version', ki.version,
      'verified', ki.is_verified,
      'metadata', jsonb_build_object(
        'item_type', ki.item_type::text,
        'source_type', ki.source_type,
        'summary', ki.summary,
        'ai_instructions', ki.ai_instructions,
        'locale', ki.locale
      )
    )), '[]'::jsonb) INTO v_knowledge_items
    FROM knowledge_items ki
    WHERE ki.story_id = p_story_id
      AND ki.status = 'active';
  END IF;

  -- Collect sync policies
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'data_domain', sp.data_domain,
    'data_class', sp.data_class::text,
    'flow_direction', sp.flow_direction::text,
    'description', sp.description
  )), '[]'::jsonb) INTO v_sync_policies
  FROM story_sync_policies sp
  WHERE sp.story_id = p_story_id;

  -- Collect expert rules content (schema 1.1.0 adds ai_instructions — part of the
  -- ruleset fingerprint). Manifest keys map to columns: content→body_markdown,
  -- tags→ai_context_tags. sub_category has no backing column (kept for shape).
  IF v_rules_blocked THEN
    v_expert_rules := '[]'::jsonb;
    v_ruleset_section := '{}'::jsonb;
    v_skipped_domains := v_skipped_domains || 'rulesets'::text;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', er.id,
      'slug', er.slug,
      'title', er.title,
      'category', er.category::text,
      'sub_category', NULL::text,
      'content', er.body_markdown,
      'ai_instructions', er.ai_instructions,
      'version', er.version,
      'tags', er.ai_context_tags
    )), '[]'::jsonb) INTO v_expert_rules
    FROM unnest(v_ruleset.rule_ids) AS rid
    JOIN expert_rules er ON er.id = rid
    WHERE er.status = 'published';

    v_ruleset_section := jsonb_build_object(
      'fingerprint', v_ruleset.ruleset_fingerprint,
      'rule_ids', to_jsonb(v_ruleset.rule_ids),
      'rule_versions', v_ruleset.rule_versions,
      'context_profile', v_ruleset.context_profile
    );
  END IF;

  -- Story metadata section
  IF v_metadata_blocked THEN
    v_story_metadata := '{}'::jsonb;
    v_skipped_domains := v_skipped_domains || 'story_metadata'::text;
  ELSE
    v_story_metadata := jsonb_build_object(
      'id', v_story.id,
      'title', v_story.title,
      'status', v_story.status,
      'tech_stack', v_story.tech_stack,
      'domain', v_story.domain,
      'project_preview', v_story.project_preview,
      'risk_profile', v_story.risk_profile,
      'repo_url', v_story.repo_url,
      'repo_provider', v_story.repo_provider,
      'default_branch', v_story.default_branch
    );
  END IF;

  -- Build config section
  IF v_build_blocked THEN
    v_build_config := '{}'::jsonb;
    v_skipped_domains := v_skipped_domains || 'build_config'::text;
  ELSE
    v_build_config := COALESCE(v_context.build_config, '{}'::jsonb);
  END IF;

  -- Build portable manifest (1.1.0: expert_rules carry ai_instructions)
  v_portable_manifest := jsonb_build_object(
    'schema_version', '1.1.0',
    'story_metadata', v_story_metadata,
    'ruleset', v_ruleset_section,
    'expert_rules', v_expert_rules,
    'knowledge_items', v_knowledge_items,
    'sync_policies', v_sync_policies,
    'portable_config', COALESCE(v_context.portable_config, '{}'::jsonb),
    'build_config', v_build_config
  );

  -- Artifact summary (counts, no content)
  v_artifact_summary := jsonb_build_object(
    'rule_count', jsonb_array_length(v_expert_rules),
    'knowledge_item_count', jsonb_array_length(v_knowledge_items),
    'sync_policy_count', jsonb_array_length(v_sync_policies),
    'skipped_domains', to_jsonb(v_skipped_domains)
  );

  -- Compute manifest integrity hash
  v_manifest_hash := encode(digest(v_portable_manifest::text, 'sha256'), 'hex');

  -- Insert bundle with manifest hash
  INSERT INTO story_bundles (
    story_id, bundle_version, ruleset_fingerprint,
    schema_version, portable_manifest, bundle_manifest_hash,
    artifact_summary, exported_by, exported_from_instance_id
  ) VALUES (
    p_story_id, v_next_version, COALESCE(v_ruleset.ruleset_fingerprint, 'unknown'),
    '1.1.0', v_portable_manifest, v_manifest_hash,
    v_artifact_summary,
    COALESCE(v_user_id::text, 'instance:' || p_source_instance_id),
    v_origin_instance.id
  ) RETURNING id INTO v_bundle_id;

  -- Create sync operation record
  INSERT INTO story_sync_operations (
    story_id, bundle_id, bundle_version, operation_type,
    source_instance_id, ruleset_fingerprint,
    actor_ref, actor_type, outcome, committed_at,
    metadata
  ) VALUES (
    p_story_id, v_bundle_id, v_next_version, 'export',
    v_origin_instance.id, COALESCE(v_ruleset.ruleset_fingerprint, 'unknown'),
    v_actor_ref, v_actor_type, 'success', now(),
    jsonb_build_object(
      'manifest_hash', v_manifest_hash,
      'skipped_domains', to_jsonb(v_skipped_domains)
    )
  ) RETURNING id INTO v_operation_id;

  -- Audit journal (user_id nullable — M2M export runs without auth.uid())
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (v_user_id, 'STORY_BUNDLE_EXPORT', jsonb_build_object(
    'area', 'story_sync',
    'severity', 'info',
    'entity_type', 'story_bundle',
    'entity_id', v_bundle_id,
    'story_id', p_story_id,
    'bundle_version', v_next_version,
    'operation_id', v_operation_id,
    'manifest_hash', v_manifest_hash,
    'actor_ref', v_actor_ref,
    'skipped_domains', to_jsonb(v_skipped_domains)
  ));

  RETURN jsonb_build_object(
    'bundle_id', v_bundle_id,
    'bundle_version', v_next_version,
    'operation_id', v_operation_id,
    'manifest_hash', v_manifest_hash,
    'ruleset_fingerprint', COALESCE(v_ruleset.ruleset_fingerprint, 'unknown'),
    'artifact_summary', v_artifact_summary,
    'skipped_domains', to_jsonb(v_skipped_domains)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.export_story_bundle(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.export_story_bundle(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_story_bundle(uuid, text, uuid) TO service_role;
