-- Function: public.create_production_log
-- Arguments: p_data jsonb
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:10+01:00

CREATE OR REPLACE FUNCTION public.create_production_log(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_log_id UUID;
  v_measurements JSONB;
BEGIN
  -- Check if user is admin or staff
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin access required');
  END IF;

  v_measurements := p_data->'measurements';

  INSERT INTO production_logs (
    batch_id,
    log_type,
    title,
    description,
    input_volume,
    input_concentration,
    output_volume,
    output_concentration,
    loss_volume,
    waste_volume,
    temperature,
    performed_by,
    performed_at
  ) VALUES (
    (p_data->>'batch_id')::UUID,
    p_data->>'log_type',
    split_part(p_data->>'description', E'\n', 1),
    p_data->>'description',
    (v_measurements->>'input_volume')::NUMERIC,
    (v_measurements->>'input_concentration')::NUMERIC,
    (v_measurements->>'output_volume')::NUMERIC,
    (v_measurements->>'output_concentration')::NUMERIC,
    (v_measurements->>'loss_volume')::NUMERIC,
    (v_measurements->>'waste_volume')::NUMERIC,
    (v_measurements->>'temperature')::NUMERIC,
    auth.uid(),
    now()
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object('success', true, 'id', v_log_id);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_production_log(p_data jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_production_log(p_data jsonb) TO authenticated;
