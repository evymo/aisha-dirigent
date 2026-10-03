-- Function: public.import_story_bundle_from_manifest
-- Arguments: p_manifest jsonb, p_bundle_version integer, p_manifest_hash text,
--            p_source_label text DEFAULT NULL, p_instance_token text DEFAULT NULL,
--            p_target_instance_id uuid DEFAULT NULL
-- Description: Transport RPC for replica instances — accepts a portable manifest
--              shipped from a remote origin, materializes it as a local
--              story_bundles row (idempotent on story_id + bundle_version), then
--              delegates the actual import to public.import_story_bundle.
--              Verifies manifest integrity (SHA-256), story existence AND
--              authorization (instance token or admin/staff) BEFORE persisting
--              the bundle row; the delegate re-validates authorization.
-- Security: SECURITY DEFINER — needed to persist the bundle row (story_bundles
--           has RLS with no policies); token/role validation runs here before
--           any write and again in import_story_bundle.

CREATE OR REPLACE FUNCTION public.import_story_bundle_from_manifest(
  p_manifest jsonb,
  p_bundle_version integer,
  p_manifest_hash text,
  p_source_label text DEFAULT NULL,
  p_instance_token text DEFAULT NULL,
  p_target_instance_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_computed_hash text;
  v_story_id uuid;
  v_bundle_id uuid;
  v_auth jsonb;
BEGIN
  -- ===== INTEGRITY VERIFICATION =====
  v_computed_hash := encode(digest(p_manifest::text, 'sha256'), 'hex');
  IF v_computed_hash != p_manifest_hash THEN
    RAISE EXCEPTION 'Manifest hash mismatch — expected %, computed %',
      p_manifest_hash, v_computed_hash USING ERRCODE = '22023';
  END IF;

  IF p_manifest->'story_metadata'->>'id' IS NULL THEN
    RAISE EXCEPTION 'Manifest missing story_metadata.id' USING ERRCODE = '22023';
  END IF;
  v_story_id := (p_manifest->'story_metadata'->>'id')::uuid;

  -- Story must already exist locally (created by bootstrap)
  IF NOT EXISTS (SELECT 1 FROM partner_stories WHERE id = v_story_id) THEN
    RAISE EXCEPTION 'Story % does not exist on this instance', v_story_id
      USING ERRCODE = '22023', HINT = 'Run bootstrap_story_replica first';
  END IF;

  -- ===== AUTHORIZATION (before any write — prevents bundle poisoning) =====
  -- The delegate re-validates; this gate ensures no story_bundles row is
  -- persisted for an unauthorized caller.
  IF p_instance_token IS NOT NULL THEN
    v_auth := public.validate_sync_authorization(
      p_target_instance_id, p_instance_token, 'import', v_story_id
    );

    IF NOT (v_auth->>'authorized')::boolean THEN
      RAISE EXCEPTION 'Unauthorized manifest import: %',
        COALESCE(v_auth->>'reason', 'invalid instance token')
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Not authenticated: provide instance token or sign in as admin/staff'
        USING ERRCODE = '22023';
    END IF;

    IF NOT public.is_admin_or_staff() THEN
      RAISE EXCEPTION 'Unauthorized: provide instance token or use admin/staff account'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ===== BUNDLE MATERIALIZATION (idempotent on story_id + bundle_version) =====
  SELECT id INTO v_bundle_id
  FROM story_bundles
  WHERE story_id = v_story_id
    AND bundle_version = p_bundle_version;

  IF v_bundle_id IS NULL THEN
    INSERT INTO story_bundles (
      story_id, bundle_version, ruleset_fingerprint,
      schema_version, portable_manifest, bundle_manifest_hash,
      artifact_summary, exported_by, exported_from_instance_id
    ) VALUES (
      v_story_id,
      p_bundle_version,
      COALESCE(p_manifest->'ruleset'->>'fingerprint', 'unknown'),
      COALESCE(p_manifest->>'schema_version', '1.0.0'),
      p_manifest,
      p_manifest_hash,
      jsonb_build_object(
        'rule_count', jsonb_array_length(COALESCE(p_manifest->'expert_rules', '[]'::jsonb)),
        'knowledge_item_count', jsonb_array_length(COALESCE(p_manifest->'knowledge_items', '[]'::jsonb)),
        'sync_policy_count', jsonb_array_length(COALESCE(p_manifest->'sync_policies', '[]'::jsonb))
      ),
      COALESCE(p_source_label, 'remote'),
      NULL  -- origin instance lives on the remote stack, not in this registry
    ) RETURNING id INTO v_bundle_id;
  END IF;

  -- ===== DELEGATE (authorization + apply logic live there) =====
  RETURN public.import_story_bundle(v_bundle_id, p_instance_token, p_target_instance_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.import_story_bundle_from_manifest(jsonb, integer, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_story_bundle_from_manifest(jsonb, integer, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_story_bundle_from_manifest(jsonb, integer, text, text, text, uuid) TO service_role;
