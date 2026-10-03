-- Function: update_provider_admin
-- Operator toggle for ai_provider_registry. Supports is_enabled, notes,
-- and reset of consecutive_failure_count — these are the fields an admin/
-- staff typically changes at runtime. Other fields (endpoint_url,
-- auth_env_var, etc.) are seeded by migrations and operator should not
-- edit at runtime — they require coordinated env-var + compose changes
-- too.
--
-- p_reset_failure_count=true forces consecutive_failure_count to 0, which
-- pulls the provider out of backoff (5min → 1h → 6h → 24h) and back into
-- base 5-minute probe cadence. Used when operator has confirmed a chronic-
-- down provider is fixed and wants to retest immediately. Existing
-- record_provider_health_result already resets on first 'healthy' probe,
-- so this is purely an operator override.
--
-- Audits via audit_journal action='PROVIDER_UPDATED' so operator history
-- of catalog mutations is visible. Mirrors update_model_registry_admin.

CREATE OR REPLACE FUNCTION public.update_provider_admin(
  p_provider_id uuid,
  p_is_enabled  boolean DEFAULT NULL,
  p_notes       text    DEFAULT NULL,
  p_reset_failure_count boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_slug              text;
  v_old_enabled       boolean;
  v_old_failure_count int;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin or staff role required' USING ERRCODE = '22023';
  END IF;

  IF p_provider_id IS NULL THEN
    RAISE EXCEPTION 'p_provider_id required' USING ERRCODE = '22023';
  END IF;

  SELECT slug, is_enabled, consecutive_failure_count
    INTO v_slug, v_old_enabled, v_old_failure_count
  FROM   ai_provider_registry
  WHERE  id = p_provider_id
  FOR    UPDATE;

  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'Provider not found: %', p_provider_id USING ERRCODE = '22023';
  END IF;

  UPDATE ai_provider_registry
  SET    is_enabled                = COALESCE(p_is_enabled, is_enabled),
         notes                     = COALESCE(p_notes, notes),
         consecutive_failure_count = CASE WHEN p_reset_failure_count THEN 0 ELSE consecutive_failure_count END,
         updated_at                = now()
  WHERE  id = p_provider_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'PROVIDER_UPDATED',
    jsonb_build_object(
      'area',                'ai',
      'severity',            'info',
      'entity_type',         'ai_provider_registry',
      'entity_id',           p_provider_id::text,
      'slug',                v_slug,
      'old_is_enabled',      v_old_enabled,
      'new_is_enabled',      COALESCE(p_is_enabled, v_old_enabled),
      'enabled_changed',     (p_is_enabled IS NOT NULL AND p_is_enabled IS DISTINCT FROM v_old_enabled),
      'notes_changed',       (p_notes IS NOT NULL),
      'failure_count_reset', p_reset_failure_count,
      'old_failure_count',   v_old_failure_count
    )
  );

  RETURN jsonb_build_object(
    'success',             true,
    'slug',                v_slug,
    'is_enabled',          COALESCE(p_is_enabled, v_old_enabled),
    'enabled_changed',     (p_is_enabled IS NOT NULL AND p_is_enabled IS DISTINCT FROM v_old_enabled),
    'failure_count_reset', p_reset_failure_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_provider_admin(uuid, boolean, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_provider_admin(uuid, boolean, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.update_provider_admin(uuid, boolean, text, boolean) IS
  'AdminProviderRegistry UI write RPC — toggle is_enabled, edit notes, optionally reset consecutive_failure_count to 0 (force re-probe at base interval). Admin/staff gate. Audits via audit_journal action=PROVIDER_UPDATED.';
