-- Function: public.create_consent_template_admin
-- Security: See function definition below.
-- Extracted: 2026-02-08T04:14:52.000Z

CREATE OR REPLACE FUNCTION public.create_consent_template_admin(p_template_key text, p_base_locale text DEFAULT 'en'::text, p_checkbox_label_key text DEFAULT NULL::text, p_consent_type consent_type DEFAULT 'data_processing'::consent_type, p_content_key text DEFAULT NULL::text, p_description_key text DEFAULT NULL::text, p_document_url text DEFAULT NULL::text, p_is_active boolean DEFAULT true, p_requires_signature boolean DEFAULT false, p_title_key text DEFAULT NULL::text, p_version text DEFAULT '1.0'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_title_key text;
  v_content_key text;
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  v_title_key := COALESCE(p_title_key, 'consent.' || p_template_key || '.title');
  v_content_key := COALESCE(p_content_key, 'consent.' || p_template_key || '.content');

  INSERT INTO public.consent_templates (
    template_key,
    version,
    is_active,
    requires_signature,
    created_by,
    code,
    consent_type,
    title_key,
    content_key,
    description_key,
    checkbox_label_key,
    document_url,
    base_locale
  ) VALUES (
    p_template_key,
    COALESCE(NULLIF(p_version, ''), '1.0'),
    COALESCE(p_is_active, true),
    COALESCE(p_requires_signature, false),
    auth.uid(),
    p_template_key,
    COALESCE(p_consent_type, 'data_processing'),
    v_title_key,
    v_content_key,
    p_description_key,
    p_checkbox_label_key,
    p_document_url,
    COALESCE(p_base_locale, 'en')
  )
  RETURNING id INTO v_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := v_id,
      p_entity_type := 'consent_template',
      p_summary := jsonb_build_object('template_key', p_template_key),
    p_user_id := auth.uid()
  );

  RETURN v_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_consent_template_admin(text, text, text, consent_type, text, text, text, boolean, boolean, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_consent_template_admin(text, text, text, consent_type, text, text, text, boolean, boolean, text, text) TO authenticated;

