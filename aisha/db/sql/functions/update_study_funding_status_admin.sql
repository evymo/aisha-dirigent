-- Function: public.update_study_funding_status_admin
-- Arguments: p_id uuid, p_status text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:29+01:00

CREATE OR REPLACE FUNCTION public.update_study_funding_status_admin(p_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(), 'manage_studies') THEN
    RAISE EXCEPTION 'Access denied: manage_studies permission required';
  END IF;

  v_status := NULLIF(trim(p_status), '');
  IF v_status IS NULL OR v_status NOT IN ('draft','funding','funded','active','completed','cancelled') THEN
    RAISE EXCEPTION 'Invalid funding status' USING ERRCODE = '22023';
  END IF;

  UPDATE public.studies
  SET funding_status = v_status,
      updated_at = now()
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Study not found';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := 'studies'::public.journal_area,
      p_details := jsonb_build_object('funding_status', v_status),
      p_entity_id := p_id::text,
      p_entity_type := 'studies',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Admin updated study funding status',
      p_tags := ARRAY['admin','studies','funding'],
      p_user_id := auth.uid()
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_study_funding_status_admin(p_id uuid, p_status text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_study_funding_status_admin(p_id uuid, p_status text) TO authenticated;
