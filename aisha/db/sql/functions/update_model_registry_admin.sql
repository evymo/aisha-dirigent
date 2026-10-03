-- Signature change (odysseus G1): admin may now override per-model pricing,
-- including the prompt-cache read rate (cached_input_price_per_m). Params added at
-- the END with DEFAULT NULL — but that makes the prior 4-arg function a separate
-- overload and a 4-arg call ambiguous, so drop the old signature first.
DROP FUNCTION IF EXISTS public.update_model_registry_admin(uuid, boolean, boolean, text);

CREATE OR REPLACE FUNCTION public.update_model_registry_admin(
  p_model_registry_id uuid,
  p_is_available boolean DEFAULT NULL,
  p_is_deprecated boolean DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_input_price_per_m numeric DEFAULT NULL,
  p_output_price_per_m numeric DEFAULT NULL,
  p_cached_input_price_per_m numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_model_id text;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin or staff role required';
  END IF;

  -- Validate at the boundary: prices are per-1M-token rates, never negative.
  IF (p_input_price_per_m IS NOT NULL AND p_input_price_per_m < 0)
     OR (p_output_price_per_m IS NOT NULL AND p_output_price_per_m < 0)
     OR (p_cached_input_price_per_m IS NOT NULL AND p_cached_input_price_per_m < 0) THEN
    RAISE EXCEPTION 'Prices must be non-negative';
  END IF;

  SELECT model_id INTO v_model_id
  FROM ai_model_registry
  WHERE id = p_model_registry_id;

  IF v_model_id IS NULL THEN
    RAISE EXCEPTION 'Model not found: %', p_model_registry_id;
  END IF;

  UPDATE ai_model_registry
  SET
    is_available = COALESCE(p_is_available, is_available),
    is_deprecated = COALESCE(p_is_deprecated, is_deprecated),
    display_name = COALESCE(p_display_name, display_name),
    -- Operator price override. COALESCE: NULL leaves the scanned/seeded value intact.
    input_price_per_m = COALESCE(p_input_price_per_m, input_price_per_m),
    output_price_per_m = COALESCE(p_output_price_per_m, output_price_per_m),
    cached_input_price_per_m = COALESCE(p_cached_input_price_per_m, cached_input_price_per_m),
    updated_at = now()
  WHERE id = p_model_registry_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'MODEL_UPDATED',
    jsonb_build_object(
      'area', 'ai',
      'severity', 'info',
      'entity_type', 'ai_model_registry',
      'entity_id', p_model_registry_id::text,
      'model_id', v_model_id,
      -- Record which price fields the operator overrode (null = untouched).
      'price_override', jsonb_strip_nulls(jsonb_build_object(
        'input_price_per_m', p_input_price_per_m,
        'output_price_per_m', p_output_price_per_m,
        'cached_input_price_per_m', p_cached_input_price_per_m
      ))
    )
  );

  RETURN jsonb_build_object('success', true, 'model_id', v_model_id);
END;
$$;

REVOKE ALL ON FUNCTION update_model_registry_admin(uuid, boolean, boolean, text, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_model_registry_admin(uuid, boolean, boolean, text, numeric, numeric, numeric) TO authenticated;
