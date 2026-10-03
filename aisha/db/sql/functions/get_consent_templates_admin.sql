-- Function: public.get_consent_templates_admin
-- Security: See function definition below.
-- Extracted: 2026-02-08T04:14:53.480Z

CREATE OR REPLACE FUNCTION public.get_consent_templates_admin()
 RETURNS TABLE(id uuid, template_key text, version text, is_active boolean, requires_signature boolean, created_at timestamptz, updated_at timestamptz, consent_type consent_type, code text, title_key text, content_key text, description_key text, checkbox_label_key text, document_url text, base_locale text)
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
      p_area := 'consent'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'consent_template',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read consent template',
      p_tags := ARRAY['admin', 'consent_template'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    ct.id,
    ct.template_key,
    ct.version,
    ct.is_active,
    ct.requires_signature,
    ct.created_at,
    ct.updated_at,
    ct.consent_type,
    ct.code,
    ct.title_key,
    ct.content_key,
    ct.description_key,
    ct.checkbox_label_key,
    ct.document_url,
    ct.base_locale
  FROM public.consent_templates ct
  ORDER BY ct.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_consent_templates_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_consent_templates_admin() TO authenticated;

