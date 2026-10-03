-- Function: public.get_production_capa_admin
-- Returns CAPA records linked to deviations
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_capa_admin(
  p_capa_type text DEFAULT NULL,
  p_source_deviation_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  capa_number text,
  source_deviation_id uuid,
  capa_type text,
  title text,
  description text,
  actions jsonb,
  owner_id uuid,
  due_date date,
  status text,
  effectiveness_check jsonb,
  effectiveness_verified_at timestamptz,
  effectiveness_verified_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  notes text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := 'read'::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := NULL,
    p_entity_type := 'production_capa',
    p_new_values := jsonb_build_object('capa_type', p_capa_type, 'status', p_status),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production CAPA',
    p_tags := ARRAY['admin', 'production_capa'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pc.id, pc.capa_number, pc.source_deviation_id, pc.capa_type,
    pc.title, pc.description, pc.actions, pc.owner_id,
    pc.due_date, pc.status, pc.effectiveness_check,
    pc.effectiveness_verified_at, pc.effectiveness_verified_by,
    pc.closed_at, pc.closed_by, pc.notes, pc.metadata,
    pc.created_at, pc.updated_at, pc.created_by
  FROM public.production_capa pc
  WHERE (p_capa_type IS NULL OR pc.capa_type = p_capa_type)
    AND (p_source_deviation_id IS NULL OR pc.source_deviation_id = p_source_deviation_id)
    AND (p_status IS NULL OR pc.status = p_status)
  ORDER BY pc.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_capa_admin(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_capa_admin(text, uuid, text) TO authenticated;
