-- Function: public.update_consent_template_admin
-- Description: Updates consent template. Uses only _key columns for localized fields.
-- Security: SECURITY DEFINER, admin/staff only.

CREATE OR REPLACE FUNCTION public.update_consent_template_admin(p_id uuid, p_base_locale text DEFAULT NULL::text, p_checkbox_label_key text DEFAULT NULL::text, p_consent_type consent_type DEFAULT NULL::consent_type, p_content_key text DEFAULT NULL::text, p_description_key text DEFAULT NULL::text, p_document_url text DEFAULT NULL::text, p_is_active boolean DEFAULT NULL::boolean, p_requires_signature boolean DEFAULT NULL::boolean, p_template_key text DEFAULT NULL::text, p_title_key text DEFAULT NULL::text, p_version text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  UPDATE public.consent_templates SET
    template_key = COALESCE(p_template_key, template_key),
    version = COALESCE(p_version, version),
    is_active = COALESCE(p_is_active, is_active),
    requires_signature = COALESCE(p_requires_signature, requires_signature),
    consent_type = COALESCE(p_consent_type, consent_type),
    title_key = COALESCE(p_title_key, title_key),
    content_key = COALESCE(p_content_key, content_key),
    description_key = COALESCE(p_description_key, description_key),
    checkbox_label_key = COALESCE(p_checkbox_label_key, checkbox_label_key),
    document_url = COALESCE(p_document_url, document_url),
    base_locale = COALESCE(p_base_locale, base_locale),
    updated_at = NOW()
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consent template not found: %', p_id;
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := p_id,
      p_entity_type := 'consent_template',
      p_summary := jsonb_build_object('template_key', p_template_key),
    p_user_id := auth.uid()
  );
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.update_consent_template_admin(uuid, text, text, consent_type, text, text, text, boolean, boolean, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_consent_template_admin(uuid, text, text, consent_type, text, text, text, boolean, boolean, text, text, text) TO authenticated;
