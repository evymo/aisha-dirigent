-- Function: public.get_label_archive_public_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:49+01:00

CREATE OR REPLACE FUNCTION public.get_label_archive_public_admin()
 RETURNS TABLE(id uuid, product_id uuid, product_name text, product_slug text, template_id uuid, version text, version_date timestamptz, archived_at timestamptz, archive_reason text, pdf_url text, is_public boolean)
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
      p_area := 'products'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'label_archive_public',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read label archive public',
      p_tags := ARRAY['admin', 'label_archive_public'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    a.id,
    a.product_id,
    p.name,
    p.slug,
    a.template_id,
    a.version,
    a.version_date,
    a.archived_at,
    a.archive_reason,
    a.pdf_url,
    a.is_public
  FROM product_label_archive a
  LEFT JOIN products p ON p.id = a.product_id
  WHERE a.is_public = true
  ORDER BY a.archived_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_label_archive_public_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_label_archive_public_admin() TO authenticated;
