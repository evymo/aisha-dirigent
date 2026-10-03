-- Function: set_slot_model_mapping
-- Soulforge: admin/staff RPC to bind a (slot, tier) pair to a specific model.
-- Writes to ai_model_registry.slot_affinity (jsonb).
-- Audit-traced; idempotent (overwrites the same slot:tier key).
-- Validates slot + tier enums and the target model existence.

CREATE OR REPLACE FUNCTION public.set_slot_model_mapping(
  p_slot     text,
  p_tier     text,
  p_model_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_target_registry_id uuid;
  v_user_id            uuid;
  v_key                text;
  v_old_value          text;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'admin_or_staff role required' USING ERRCODE = '22023';
  END IF;

  -- Validate slot enum (mirror of TaskSlot in soulforge.ts)
  IF p_slot NOT IN ('spark','ember','webSearch','desloppify','verify','compact','semantic','default') THEN
    RAISE EXCEPTION 'Invalid slot: %', p_slot USING ERRCODE = '22023';
  END IF;

  -- Validate tier enum (mirror of MessageComplexity)
  IF p_tier NOT IN ('greeting','simple','moderate','complex','deep_analysis') THEN
    RAISE EXCEPTION 'Invalid tier: %', p_tier USING ERRCODE = '22023';
  END IF;

  IF p_model_id IS NULL OR p_model_id = '' THEN
    RAISE EXCEPTION 'p_model_id is required' USING ERRCODE = '22023';
  END IF;

  -- Locate the model row this mapping should be attached to.
  SELECT id INTO v_target_registry_id
  FROM ai_model_registry
  WHERE model_id = p_model_id
  ORDER BY (NOT is_deprecated) DESC, last_seen_at DESC
  LIMIT 1;

  IF v_target_registry_id IS NULL THEN
    RAISE EXCEPTION 'Model % not found in ai_model_registry', p_model_id USING ERRCODE = '22023';
  END IF;

  v_key := p_slot || ':' || p_tier;

  -- Capture prior value for audit
  SELECT slot_affinity ->> v_key INTO v_old_value
  FROM ai_model_registry
  WHERE id = v_target_registry_id;

  UPDATE ai_model_registry
  SET slot_affinity = COALESCE(slot_affinity, '{}'::jsonb)
                     || jsonb_build_object(v_key, p_model_id),
      updated_at = now()
  WHERE id = v_target_registry_id;

  -- Defensive: remove any DUPLICATE binding of the same slot:tier on OTHER rows
  -- (slot:tier should map to exactly one model).
  UPDATE ai_model_registry
  SET slot_affinity = slot_affinity - v_key,
      updated_at = now()
  WHERE id != v_target_registry_id
    AND slot_affinity ? v_key;

  v_user_id := auth.uid();

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'soulforge.slot_mapping_updated',
    jsonb_build_object(
      'slot', p_slot,
      'tier', p_tier,
      'model_id', p_model_id,
      'old_model_id', v_old_value,
      'registry_id', v_target_registry_id
    )
  );

  RETURN jsonb_build_object(
    'status', 'updated',
    'slot', p_slot,
    'tier', p_tier,
    'model_id', p_model_id,
    'previous', v_old_value
  );
END;
$$;

COMMENT ON FUNCTION public.set_slot_model_mapping(text, text, text) IS
  'Soulforge: admin/staff updates ai_model_registry.slot_affinity for a slot×tier pair. '
  'Audit-traced. Validates enum membership and deduplicates the slot:tier key '
  'across registry rows.';

REVOKE ALL ON FUNCTION public.set_slot_model_mapping(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_slot_model_mapping(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_slot_model_mapping(text, text, text) TO service_role;
