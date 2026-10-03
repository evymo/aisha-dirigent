-- Function: public.archive_label_template_admin
-- Arguments: p_template_id uuid, p_archived_by text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:52+01:00

CREATE OR REPLACE FUNCTION public.archive_label_template_admin(p_template_id uuid, p_archived_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_template RECORD;
BEGIN
  -- Check if user is admin or staff
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin access required');
  END IF;

  -- Get template
  SELECT * INTO v_template
  FROM product_label_templates
  WHERE id = p_template_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Template not found');
  END IF;

  -- Create archive entry
  INSERT INTO product_label_archive (
    product_id,
    template_id,
    version,
    version_date,
    label_data,
    pdf_url,
    archived_by,
    archive_reason
  ) VALUES (
    v_template.product_id,
    v_template.id,
    v_template.version,
    v_template.version_date,
    to_jsonb(v_template),
    v_template.label_pdf_url,
    COALESCE(p_archived_by, auth.uid()::TEXT),
    'Manual archive'
  );

  -- Update template status
  UPDATE product_label_templates
  SET status = 'archived', updated_at = now()
  WHERE id = p_template_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := 'products'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_template_id::text,
      p_entity_type := 'label_template',
      p_new_values := jsonb_build_object('id', p_template_id),
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin archived label template',
      p_tags := ARRAY['admin', 'label_template', 'archive'],
      p_user_id := auth.uid()
  );

  RETURN jsonb_build_object('success', true);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.archive_label_template_admin(p_template_id uuid, p_archived_by text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_label_template_admin(p_template_id uuid, p_archived_by text) TO authenticated;
