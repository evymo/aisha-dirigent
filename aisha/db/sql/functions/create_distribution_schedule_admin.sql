-- Function: public.create_distribution_schedule_admin
-- Arguments: p_scheduled_date date, p_scheduled_time time, p_notes text
-- Description: Create a distribution schedule entry. Admin/staff only.
-- Security: SECURITY DEFINER, process_orders or view_admin_dashboard permission required
-- Updated: 2026-01-09 - Added p_notes param

CREATE OR REPLACE FUNCTION public.create_distribution_schedule_admin(
  p_scheduled_date date, 
  p_scheduled_time time without time zone DEFAULT '14:00:00'::time without time zone,
  p_notes text DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_permission(auth.uid(), 'process_orders')
    OR public.has_permission(auth.uid(), 'view_admin_dashboard')
  ) THEN
    RAISE EXCEPTION 'Access denied: process_orders or view_admin_dashboard permission required';
  END IF;

  INSERT INTO public.distribution_calendar (
    scheduled_date,
    scheduled_time,
    notes
  )
  VALUES (
    p_scheduled_date,
    p_scheduled_time,
    p_notes
  )
  RETURNING id INTO v_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area := 'orders'::public.journal_area,
      p_details := NULL,
      p_entity_id := v_id::text,
      p_entity_type := 'distribution_calendar',
      p_new_values := jsonb_build_object(
      'scheduled_date', p_scheduled_date,
      'scheduled_time', p_scheduled_time,
      'has_notes', p_notes IS NOT NULL
    ),
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin created distribution schedule',
      p_tags := ARRAY['admin','distribution','calendar','create'],
      p_user_id := auth.uid()
  );

  RETURN v_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_distribution_schedule_admin(p_scheduled_date date, p_scheduled_time time without time zone, p_notes text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_distribution_schedule_admin(p_scheduled_date date, p_scheduled_time time without time zone, p_notes text) TO authenticated;
