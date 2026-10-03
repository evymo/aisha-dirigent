-- Function: public.bootstrap_story_replica
-- Arguments: p_manifest jsonb, p_manifest_hash text, p_instance_label text DEFAULT 'replica', p_instance_type text DEFAULT 'self-hosted'
-- Description: Bootstraps a replica of a story on this instance from a portable
--              manifest (produced by export_story_bundle on the origin stack).
--              Verifies SHA-256 manifest integrity, then idempotently creates:
--              1. partner_stories row with the SAME id as the origin story
--                 (origin 'replica_sync', no partner/user binding)
--              2. story_contexts row (defaults; filled by subsequent import)
--              3. a non-origin story_instances row for this replica
--              Safe to re-run: existing rows are kept untouched.
-- Security: SECURITY DEFINER — service_role or admin/staff only.
--           DEFINER (not INVOKER per ensure_stack_default_story) because
--           story_instances has RLS enabled with NO policies, so an admin/staff
--           invoker could never INSERT the replica instance row under INVOKER
--           semantics. Explicit role check below compensates.

CREATE OR REPLACE FUNCTION public.bootstrap_story_replica(
  p_manifest jsonb,
  p_manifest_hash text,
  p_instance_label text DEFAULT 'replica',
  p_instance_type text DEFAULT 'self-hosted'
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_is_service boolean;
  v_computed_hash text;
  v_story_id_text text;
  v_story_id uuid;
  v_metadata jsonb;
  v_project_preview jsonb;
  v_existing_story_id uuid;
  v_existing_context_story_id uuid;
  v_instance_id uuid;
  v_created_story boolean := false;
  v_created_context boolean := false;
  v_created_instance boolean := false;
BEGIN
  -- ===== AUTHORIZATION: service_role or admin/staff =====
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin/staff or service_role required' USING ERRCODE = '22023';
  END IF;

  -- ===== INTEGRITY VERIFICATION =====
  v_computed_hash := encode(digest(p_manifest::text, 'sha256'), 'hex');
  IF v_computed_hash != p_manifest_hash THEN
    RAISE EXCEPTION 'Manifest hash mismatch — expected %, computed %',
      p_manifest_hash, v_computed_hash USING ERRCODE = '22023';
  END IF;

  v_metadata := p_manifest->'story_metadata';
  v_story_id_text := v_metadata->>'id';
  IF v_story_id_text IS NULL
     OR v_story_id_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'Invalid or missing story id in manifest' USING ERRCODE = '22023';
  END IF;
  v_story_id := v_story_id_text::uuid;

  -- ===== 1. partner_stories (same id as origin story) =====
  SELECT id INTO v_existing_story_id
  FROM partner_stories
  WHERE id = v_story_id;

  IF v_existing_story_id IS NULL THEN
    -- project_preview must satisfy the shape check constraint
    v_project_preview := v_metadata->'project_preview';
    IF v_project_preview IS NULL
       OR jsonb_typeof(v_project_preview) != 'object'
       OR NOT (v_project_preview ?& ARRAY['summary', 'goals', 'constraints', 'success_criteria']) THEN
      v_project_preview := '{"summary":"","goals":[],"constraints":[],"success_criteria":[],"meta":{}}'::jsonb;
    END IF;

    INSERT INTO partner_stories (
      id, partner_id, user_id, title, status,
      tech_stack, domain, project_preview, risk_profile,
      repo_url, repo_provider, default_branch, origin
    ) VALUES (
      v_story_id, NULL, NULL,
      COALESCE(v_metadata->>'title', 'Replicated story'),
      COALESCE(v_metadata->>'status', 'active'),
      CASE WHEN jsonb_typeof(v_metadata->'tech_stack') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(v_metadata->'tech_stack'))
        ELSE NULL END,
      CASE WHEN jsonb_typeof(v_metadata->'domain') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(v_metadata->'domain'))
        ELSE NULL END,
      v_project_preview,
      v_metadata->>'risk_profile',
      v_metadata->>'repo_url',
      v_metadata->>'repo_provider',
      v_metadata->>'default_branch',
      'replica_sync'
    );
    v_created_story := true;
  END IF;

  -- ===== 2. story_contexts (PK on story_id — check-then-insert) =====
  SELECT story_id INTO v_existing_context_story_id
  FROM story_contexts
  WHERE story_id = v_story_id;

  IF v_existing_context_story_id IS NULL THEN
    INSERT INTO story_contexts (story_id) VALUES (v_story_id);
    v_created_context := true;
  END IF;

  -- ===== 3. story_instances (non-origin replica instance) =====
  -- Concurrency-safe upsert backed by the partial unique index
  -- idx_story_instances_replica_label_unique (story_id, instance_label)
  -- WHERE is_origin = false — parallel bootstraps cannot duplicate the row.
  INSERT INTO story_instances (
    story_id, instance_label, instance_type, is_origin
  ) VALUES (
    v_story_id, p_instance_label, p_instance_type, false
  )
  ON CONFLICT (story_id, instance_label) WHERE is_origin = false
  DO NOTHING
  RETURNING id INTO v_instance_id;

  v_created_instance := FOUND;

  IF v_instance_id IS NULL THEN
    SELECT id INTO v_instance_id
    FROM story_instances
    WHERE story_id = v_story_id
      AND instance_label = p_instance_label
      AND is_origin = false
    ORDER BY created_at
    LIMIT 1;
  END IF;

  -- Audit journal (user_id nullable — service actors have auth.uid() NULL, FK-safe)
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'STORY_REPLICA_BOOTSTRAPPED', jsonb_build_object(
    'area', 'story_sync',
    'severity', 'info',
    'entity_type', 'partner_story',
    'entity_id', v_story_id,
    'instance_id', v_instance_id,
    'instance_label', p_instance_label,
    'manifest_hash', p_manifest_hash,
    'created_story', v_created_story,
    'created_context', v_created_context,
    'created_instance', v_created_instance
  ));

  RETURN jsonb_build_object(
    'story_id', v_story_id,
    'instance_id', v_instance_id,
    'created_story', v_created_story,
    'created_context', v_created_context,
    'created_instance', v_created_instance
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.bootstrap_story_replica(jsonb, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_story_replica(jsonb, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_story_replica(jsonb, text, text, text) TO service_role;
