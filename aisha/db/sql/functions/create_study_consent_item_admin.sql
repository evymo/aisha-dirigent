-- Function: public.create_study_consent_item_admin
-- Description: Creates study consent item. Auto-generates _key values from consent_key.
-- Security: SECURITY DEFINER, admin/staff only.

CREATE OR REPLACE FUNCTION public.create_study_consent_item_admin(p_study_id uuid, p_consent_key text, p_checkbox_label_key text DEFAULT NULL::text, p_description_key text DEFAULT NULL::text, p_display_order integer DEFAULT 0, p_document_url text DEFAULT NULL::text, p_is_active boolean DEFAULT true, p_is_required boolean DEFAULT true, p_title_key text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_title_key text;
  v_description_key text;
  v_checkbox_label_key text;
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  v_title_key := COALESCE(p_title_key, 'consent_item.' || p_consent_key || '.title');
  v_description_key := COALESCE(p_description_key, 'consent_item.' || p_consent_key || '.description');
  v_checkbox_label_key := COALESCE(p_checkbox_label_key, 'consent_item.' || p_consent_key || '.checkbox_label');

  INSERT INTO public.study_consent_items (
    study_id,
    consent_key,
    document_url,
    is_required,
    display_order,
    is_active,
    title_key,
    description_key,
    checkbox_label_key
  ) VALUES (
    p_study_id,
    p_consent_key,
    p_document_url,
    COALESCE(p_is_required, true),
    COALESCE(p_display_order, 0),
    COALESCE(p_is_active, true),
    v_title_key,
    v_description_key,
    v_checkbox_label_key
  )
  RETURNING id INTO v_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := v_id,
      p_entity_type := 'study_consent_item',
      p_summary := jsonb_build_object('study_id', p_study_id, 'consent_key', p_consent_key),
    p_user_id := auth.uid()
  );

  RETURN v_id;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.create_study_consent_item_admin(uuid, text, text, text, integer, text, boolean, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_study_consent_item_admin(uuid, text, text, text, integer, text, boolean, boolean, text) TO authenticated;
