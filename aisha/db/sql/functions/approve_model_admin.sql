CREATE OR REPLACE FUNCTION public.approve_model_admin(
  p_model_registry_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_model_id text;
  v_provider text;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin or staff role required';
  END IF;

  -- Get model info + verify exists
  SELECT model_id, provider INTO v_model_id, v_provider
  FROM ai_model_registry
  WHERE id = p_model_registry_id;

  IF v_model_id IS NULL THEN
    RAISE EXCEPTION 'Model not found: %', p_model_registry_id;
  END IF;

  -- Update eval_status
  UPDATE ai_model_registry
  SET eval_status = 'approved',
      updated_at = now()
  WHERE id = p_model_registry_id;

  -- Audit trail
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'MODEL_APPROVED',
    jsonb_build_object(
      'area', 'ai',
      'severity', 'info',
      'entity_type', 'ai_model_registry',
      'entity_id', p_model_registry_id::text,
      'model_id', v_model_id,
      'provider', v_provider
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'model_id', v_model_id,
    'provider', v_provider,
    'eval_status', 'approved'
  );
END;
$$;

REVOKE ALL ON FUNCTION approve_model_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION approve_model_admin(uuid) TO authenticated;
