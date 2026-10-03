-- Function: public.get_study_consent_items_admin
-- Description: Returns study consent items. Uses _key columns only for localized fields.
-- Security: SECURITY DEFINER, admin/staff only.

CREATE OR REPLACE FUNCTION public.get_study_consent_items_admin(p_study_id uuid)
 RETURNS TABLE(id uuid, study_id uuid, consent_key text, document_url text, is_required boolean, display_order integer, is_active boolean, created_at timestamptz, updated_at timestamptz, title_key text, description_key text, checkbox_label_key text)
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
      p_area := 'research'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_study_id::text,
      p_entity_type := 'study_consent_item',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read study consent item',
      p_tags := ARRAY['admin', 'study_consent_item'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    sci.id,
    sci.study_id,
    sci.consent_key,
    sci.document_url,
    sci.is_required,
    sci.display_order,
    sci.is_active,
    sci.created_at,
    sci.updated_at,
    COALESCE(sci.title_key, '') AS title_key,
    COALESCE(sci.description_key, '') AS description_key,
    COALESCE(sci.checkbox_label_key, '') AS checkbox_label_key
  FROM public.study_consent_items sci
  WHERE sci.study_id = p_study_id
  ORDER BY sci.display_order, sci.created_at;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_study_consent_items_admin(p_study_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_consent_items_admin(p_study_id uuid) TO authenticated;
