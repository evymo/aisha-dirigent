-- Function: public.update_production_protocol_step_admin
-- Arguments: p_step_id uuid, p_patch jsonb, p_notes text, p_status text
-- Description: Update a production protocol step. Admin/staff only.
-- Security: SECURITY DEFINER, admin or staff role required
-- Updated: 2026-02-19 - Fixed audit journal call, added metadata merge support

CREATE OR REPLACE FUNCTION public.update_production_protocol_step_admin(
  p_step_id uuid,
  p_patch jsonb DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_effective_patch jsonb;
  v_batch_id uuid;
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin access required');
  END IF;

  -- Get batch_id for audit
  SELECT batch_id INTO v_batch_id
  FROM production_protocol_steps
  WHERE id = p_step_id;

  -- Merge standalone params into patch
  v_effective_patch := COALESCE(p_patch, '{}'::jsonb);
  IF p_notes IS NOT NULL THEN
    v_effective_patch := v_effective_patch || jsonb_build_object('notes', p_notes);
  END IF;
  IF p_status IS NOT NULL THEN
    v_effective_patch := v_effective_patch || jsonb_build_object('status', p_status);
  END IF;

  -- Validate status if provided
  IF v_effective_patch ? 'status' THEN
    v_status := v_effective_patch->>'status';
    IF v_status NOT IN ('pending', 'in_progress', 'completed', 'skipped', 'failed') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Invalid status');
    END IF;
  END IF;

  UPDATE production_protocol_steps
  SET
    status = COALESCE(v_status, status)::production_step_status,
    started_at = COALESCE((v_effective_patch->>'started_at')::timestamptz, started_at),
    completed_at = COALESCE((v_effective_patch->>'completed_at')::timestamptz, completed_at),
    actual_input_volume = COALESCE((v_effective_patch->>'actual_input_volume')::numeric, actual_input_volume),
    actual_output_volume = COALESCE((v_effective_patch->>'actual_output_volume')::numeric, actual_output_volume),
    actual_loss = COALESCE((v_effective_patch->>'actual_loss')::numeric, actual_loss),
    notes = COALESCE(v_effective_patch->>'notes', notes),
    metadata = CASE
      WHEN v_effective_patch ? 'metadata' THEN COALESCE(metadata, '{}'::jsonb) || (v_effective_patch->'metadata')
      ELSE metadata
    END,
    updated_at = now()
  WHERE id = p_step_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Step not found');
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := 'update'::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := p_step_id,
    p_entity_type := 'production_protocol_step',
    p_new_values := jsonb_build_object(
      'fields', (SELECT jsonb_agg(key) FROM jsonb_object_keys(v_effective_patch) AS key),
      'batch_id', v_batch_id
    ),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin updated production protocol step',
    p_tags := ARRAY['admin', 'production_protocol_step'],
    p_user_id := auth.uid()
  );

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.update_production_protocol_step_admin(p_step_id uuid, p_patch jsonb, p_notes text, p_status text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_production_protocol_step_admin(p_step_id uuid, p_patch jsonb, p_notes text, p_status text) TO authenticated;
