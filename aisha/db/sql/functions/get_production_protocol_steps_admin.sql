-- Function: public.get_production_protocol_steps_admin
-- Arguments: p_batch_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:22+01:00

CREATE OR REPLACE FUNCTION public.get_production_protocol_steps_admin(p_batch_id uuid)
 RETURNS TABLE(id uuid, batch_id uuid, step_order integer, step_name text, step_type text, expected_input_volume numeric, expected_output_volume numeric, actual_input_volume numeric, actual_output_volume numeric, expected_loss numeric, actual_loss numeric, status text, started_at timestamptz, completed_at timestamptz, notes text, verification_notes text, verified_at timestamptz, tokens_minted numeric, tokens_burned numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'products'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_batch_id::text,
      p_entity_type := 'production_protocol_step',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read production protocol step',
      p_tags := ARRAY['admin', 'production_protocol_step'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    s.id,
    s.batch_id,
    s.step_order,
    s.step_name,
    s.step_type,
    s.expected_input_volume,
    s.expected_output_volume,
    s.actual_input_volume,
    s.actual_output_volume,
    s.expected_loss,
    s.actual_loss,
    s.status::text,
    s.started_at,
    s.completed_at,
    s.notes,
    s.verification_notes,
    s.verified_at,
    s.tokens_minted,
    s.tokens_burned
  FROM production_protocol_steps s
  WHERE s.batch_id = p_batch_id
  ORDER BY s.step_order ASC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_production_protocol_steps_admin(p_batch_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_protocol_steps_admin(p_batch_id uuid) TO authenticated;
