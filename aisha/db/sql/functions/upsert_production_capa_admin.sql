-- Function: public.upsert_production_capa_admin
-- Creates or updates a CAPA record
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.upsert_production_capa_admin(
  p_actions jsonb DEFAULT '[]'::jsonb,
  p_capa_number text DEFAULT NULL,
  p_capa_type text DEFAULT 'corrective',
  p_description text DEFAULT NULL,
  p_due_date date DEFAULT NULL,
  p_effectiveness_check jsonb DEFAULT NULL,
  p_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_notes text DEFAULT NULL,
  p_owner_id uuid DEFAULT NULL,
  p_source_deviation_id uuid DEFAULT NULL,
  p_status text DEFAULT 'open',
  p_title text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result_id uuid;
  v_action text;
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  IF p_capa_number IS NULL OR p_title IS NULL OR p_description IS NULL THEN
    RAISE EXCEPTION 'capa_number, title and description are required';
  END IF;

  IF p_id IS NOT NULL THEN
    v_action := 'update';
    UPDATE public.production_capa SET
      capa_number = p_capa_number,
      source_deviation_id = p_source_deviation_id,
      capa_type = p_capa_type,
      title = p_title,
      description = p_description,
      actions = p_actions,
      owner_id = p_owner_id,
      due_date = p_due_date,
      status = p_status,
      effectiveness_check = p_effectiveness_check,
      closed_at = CASE WHEN p_status = 'closed' AND status != 'closed' THEN now() ELSE closed_at END,
      closed_by = CASE WHEN p_status = 'closed' AND status != 'closed' THEN auth.uid() ELSE closed_by END,
      notes = p_notes,
      metadata = p_metadata,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_result_id;
  ELSE
    v_action := 'create';
    INSERT INTO public.production_capa (
      capa_number, source_deviation_id, capa_type, title, description,
      actions, owner_id, due_date, status,
      effectiveness_check, notes, metadata, created_by
    ) VALUES (
      p_capa_number, p_source_deviation_id, p_capa_type, p_title, p_description,
      p_actions, p_owner_id, p_due_date, p_status,
      p_effectiveness_check, p_notes, p_metadata, auth.uid()
    )
    RETURNING id INTO v_result_id;
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := v_action::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := v_result_id::text,
    p_entity_type := 'production_capa',
    p_new_values := jsonb_build_object('capa_number', p_capa_number, 'capa_type', p_capa_type, 'status', p_status),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := format('Admin %s production CAPA %s', v_action, p_capa_number),
    p_tags := ARRAY['admin', 'production_capa'],
    p_user_id := auth.uid()
  );

  RETURN v_result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_production_capa_admin(jsonb, text, text, text, date, jsonb, uuid, jsonb, text, uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_production_capa_admin(jsonb, text, text, text, date, jsonb, uuid, jsonb, text, uuid, uuid, text, text) TO authenticated;
