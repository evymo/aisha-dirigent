-- Function: public.update_study_consent_item_admin
-- Description: Updates study consent item. Uses only _key columns for localized fields.
-- Security: SECURITY DEFINER, admin/staff only.

CREATE OR REPLACE FUNCTION public.update_study_consent_item_admin(p_id uuid, p_checkbox_label_key text DEFAULT NULL::text, p_consent_key text DEFAULT NULL::text, p_description_key text DEFAULT NULL::text, p_display_order integer DEFAULT NULL::integer, p_document_url text DEFAULT NULL::text, p_is_active boolean DEFAULT NULL::boolean, p_is_required boolean DEFAULT NULL::boolean, p_title_key text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  UPDATE public.study_consent_items SET
    consent_key = COALESCE(p_consent_key, consent_key),
    document_url = COALESCE(p_document_url, document_url),
    is_required = COALESCE(p_is_required, is_required),
    display_order = COALESCE(p_display_order, display_order),
    is_active = COALESCE(p_is_active, is_active),
    title_key = COALESCE(p_title_key, title_key),
    description_key = COALESCE(p_description_key, description_key),
    checkbox_label_key = COALESCE(p_checkbox_label_key, checkbox_label_key),
    updated_at = NOW()
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Study consent item not found: %', p_id;
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := p_id,
      p_entity_type := 'study_consent_item',
      p_summary := NULL,
    p_user_id := auth.uid()
  );
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.update_study_consent_item_admin(uuid, text, text, text, integer, text, boolean, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_study_consent_item_admin(uuid, text, text, text, integer, text, boolean, boolean, text) TO authenticated;
