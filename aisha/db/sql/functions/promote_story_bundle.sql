-- Function: public.promote_story_bundle
-- Arguments: p_manifest jsonb, p_manifest_hash text, p_source_instance_id uuid, p_instance_token text DEFAULT NULL
-- Description: Proposes upstream changes from a replica to the origin (promote flow).
--              Runs on the ORIGIN side: verifies manifest integrity (SHA-256),
--              authorizes the source replica (token with scope 'sync:promote', or
--              admin/staff without token), filters manifest sections by sync
--              policies (only 'promote_on_approval' domains are promotable — v1
--              materializes knowledge_items only) and records a PENDING
--              story_sync_operations row holding the promotable payload.
--              Nothing is materialized here — approve_story_promotion does that.
-- Security: SECURITY DEFINER — token-authorized replica (auth.uid() may be NULL)
--           or admin/staff account

CREATE OR REPLACE FUNCTION public.promote_story_bundle(
  p_manifest jsonb,
  p_manifest_hash text,
  p_source_instance_id uuid,
  p_instance_token text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_id uuid;
  v_story_id_text text;
  v_story_id uuid;
  v_story_exists boolean;
  v_source_instance record;
  v_origin_instance_id uuid;
  v_auth_result jsonb;
  v_blocked_domains jsonb;
  v_computed_hash text;
  v_knowledge_items jsonb;
  v_ki_count integer := 0;
  v_payload jsonb := '{}'::jsonb;
  v_blocked_domain_names text[] := '{}';
  v_operation_id uuid;
BEGIN
  v_user_id := auth.uid();  -- may be NULL for token-authenticated replica calls

  IF p_manifest IS NULL OR jsonb_typeof(p_manifest) != 'object' THEN
    RAISE EXCEPTION 'Manifest must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF p_manifest_hash IS NULL THEN
    RAISE EXCEPTION 'Manifest hash is required' USING ERRCODE = '22023';
  END IF;

  -- Resolve story from manifest (story_metadata.id; top-level story_id tolerated).
  -- Read as text and validate the UUID shape before casting — a malformed id
  -- must fail as 22023 validation, not as a cast error.
  v_story_id_text := COALESCE(
    p_manifest->'story_metadata'->>'id',
    p_manifest->>'story_id'
  );

  IF v_story_id_text IS NULL
     OR v_story_id_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'Invalid or missing story id in manifest' USING ERRCODE = '22023';
  END IF;
  v_story_id := v_story_id_text::uuid;

  SELECT EXISTS (
    SELECT 1 FROM partner_stories WHERE id = v_story_id
  ) INTO v_story_exists;

  IF NOT v_story_exists THEN
    RAISE EXCEPTION 'Story not found: %', v_story_id USING ERRCODE = '22023';
  END IF;

  -- Load source instance (the promoting replica)
  SELECT si.id, si.story_id, si.is_origin, si.status
  INTO v_source_instance
  FROM story_instances si
  WHERE si.id = p_source_instance_id;

  IF v_source_instance.id IS NULL THEN
    RAISE EXCEPTION 'Source instance not found: %', p_source_instance_id USING ERRCODE = '22023';
  END IF;

  IF v_source_instance.story_id != v_story_id THEN
    RAISE EXCEPTION 'Instance % does not belong to story %', p_source_instance_id, v_story_id USING ERRCODE = '22023';
  END IF;

  -- ===== AUTHORIZATION =====
  -- Token provided: validate via instance auth (scope 'sync:promote' + origin rules
  -- + blocked domains). No token: require admin/staff and apply the same policy
  -- filter directly.
  IF p_instance_token IS NOT NULL THEN
    v_auth_result := public.validate_sync_authorization(
      p_source_instance_id, p_instance_token, 'promote', v_story_id
    );

    IF NOT (v_auth_result->>'authorized')::boolean THEN
      -- user_id may be NULL (token/service actor) — FK-safe, see
      -- validate_sync_authorization.sql
      INSERT INTO audit_journal (user_id, action, metadata)
      VALUES (v_user_id, 'SYNC_PROMOTE_DENIED', jsonb_build_object(
        'area', 'story_sync', 'severity', 'warning',
        'story_id', v_story_id,
        'source_instance_id', p_source_instance_id,
        'reason', v_auth_result->>'reason'
      ));

      RETURN jsonb_build_object(
        'status', 'denied',
        'reason', v_auth_result->>'reason'
      );
    END IF;

    v_blocked_domains := COALESCE(v_auth_result->'blocked_domains', '[]'::jsonb);
  ELSE
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
    END IF;

    IF NOT public.is_admin_or_staff() THEN
      RAISE EXCEPTION 'Unauthorized: provide instance token or use admin/staff account' USING ERRCODE = '22023';
    END IF;

    -- Same origin rule as the token path: origin does not promote to itself
    IF v_source_instance.is_origin THEN
      RAISE EXCEPTION 'Origin does not promote to itself' USING ERRCODE = '22023';
    END IF;

    -- Same policy filter as validate_sync_authorization for 'promote'
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'data_domain', sp.data_domain,
      'flow_direction', sp.flow_direction::text,
      'blocked', true
    ) ORDER BY sp.data_domain), '[]'::jsonb) INTO v_blocked_domains
    FROM story_sync_policies sp
    WHERE sp.story_id = v_story_id
      AND sp.flow_direction <> 'promote_on_approval';
  END IF;

  -- ===== INTEGRITY VERIFICATION =====
  v_computed_hash := encode(digest(p_manifest::text, 'sha256'), 'hex');

  IF v_computed_hash != p_manifest_hash THEN
    INSERT INTO audit_journal (user_id, action, metadata)
    VALUES (v_user_id, 'SYNC_INTEGRITY_VIOLATION', jsonb_build_object(
      'area', 'story_sync', 'severity', 'critical',
      'story_id', v_story_id,
      'source_instance_id', p_source_instance_id,
      'operation_type', 'promote',
      'expected_hash', p_manifest_hash,
      'computed_hash', v_computed_hash
    ));

    RETURN jsonb_build_object(
      'status', 'integrity_error',
      'reason', 'Manifest hash mismatch — possible tampering detected'
    );
  END IF;

  -- ===== PROMOTABLE PAYLOAD =====
  -- Domain → manifest section mapping: 'knowledge_items' → knowledge_items.
  -- v1 materializes knowledge_items only; other promote_on_approval domains
  -- would extend v_payload here.
  SELECT COALESCE(array_agg(bd->>'data_domain'), '{}')
  INTO v_blocked_domain_names
  FROM jsonb_array_elements(v_blocked_domains) bd
  WHERE (bd->>'blocked')::boolean = true;

  IF NOT ('knowledge_items' = ANY (v_blocked_domain_names))
     AND jsonb_typeof(p_manifest->'knowledge_items') = 'array'
  THEN
    v_knowledge_items := p_manifest->'knowledge_items';
    v_ki_count := jsonb_array_length(v_knowledge_items);
  END IF;

  IF v_ki_count = 0 THEN
    RETURN jsonb_build_object(
      'status', 'nothing_to_promote',
      'reason', 'Manifest carries no data in promotable domains (v1: knowledge_items)',
      'blocked_domains', v_blocked_domains
    );
  END IF;

  v_payload := jsonb_build_object('knowledge_items', v_knowledge_items);

  -- Resolve the origin instance of the story (promotion target)
  SELECT si.id INTO v_origin_instance_id
  FROM story_instances si
  WHERE si.story_id = v_story_id AND si.is_origin = true;

  IF v_origin_instance_id IS NULL THEN
    RAISE EXCEPTION 'No origin instance registered for story %', v_story_id USING ERRCODE = '22023';
  END IF;

  -- Create PENDING promote operation carrying the promotable payload
  INSERT INTO story_sync_operations (
    story_id, operation_type,
    source_instance_id, target_instance_id,
    ruleset_fingerprint,
    actor_ref, actor_type, outcome,
    metadata
  ) VALUES (
    v_story_id, 'promote',
    p_source_instance_id, v_origin_instance_id,
    p_manifest->'ruleset'->>'fingerprint',
    COALESCE(v_user_id::text, 'instance:' || p_source_instance_id::text),
    CASE WHEN p_instance_token IS NOT NULL THEN 'instance' ELSE 'human' END,
    'pending',
    jsonb_build_object(
      'manifest_hash', p_manifest_hash,
      'manifest_schema_version', p_manifest->>'schema_version',
      'payload', v_payload,
      'counts', jsonb_build_object('knowledge_items', v_ki_count),
      'blocked_domains', v_blocked_domains
    )
  ) RETURNING id INTO v_operation_id;

  -- Audit journal (user_id may be NULL — FK-safe)
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (v_user_id, 'STORY_PROMOTE_PROPOSED', jsonb_build_object(
    'area', 'story_sync',
    'severity', 'info',
    'entity_type', 'story_sync_operation',
    'entity_id', v_operation_id,
    'story_id', v_story_id,
    'source_instance_id', p_source_instance_id,
    'target_instance_id', v_origin_instance_id,
    'manifest_hash', p_manifest_hash,
    'promotable_items', v_ki_count
  ));

  RETURN jsonb_build_object(
    'operation_id', v_operation_id,
    'status', 'pending',
    'promotable_items', v_ki_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.promote_story_bundle(jsonb, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_story_bundle(jsonb, text, uuid, text) TO authenticated;
-- Token-authenticated replicas call through the stack backend under service_role
-- (auth.uid() IS NULL) — the token itself is validated inside.
GRANT EXECUTE ON FUNCTION public.promote_story_bundle(jsonb, text, uuid, text) TO service_role;
