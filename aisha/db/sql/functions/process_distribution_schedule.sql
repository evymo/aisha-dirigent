-- Function: public.process_distribution_schedule
-- Arguments: p_schedule_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:58+01:00

CREATE OR REPLACE FUNCTION public.process_distribution_schedule(p_schedule_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_processed int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  UPDATE distribution_calendar
  SET status = 'processed', processed_at = now()
  WHERE id = p_schedule_id;

  RETURN jsonb_build_object('processed', v_processed, 'schedule_id', p_schedule_id);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.process_distribution_schedule(p_schedule_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_distribution_schedule(p_schedule_id uuid) TO authenticated;
