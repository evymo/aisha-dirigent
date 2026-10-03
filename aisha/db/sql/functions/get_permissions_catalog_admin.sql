-- Function: public.get_permissions_catalog_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:19+01:00

CREATE OR REPLACE FUNCTION public.get_permissions_catalog_admin()
 RETURNS TABLE(category text, code text, created_at timestamptz, description text, id uuid, is_system boolean, name text, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Require admin or staff
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'admin'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'permissions_catalog',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read permissions catalog',
      p_tags := ARRAY['admin', 'permissions_catalog'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT 
    p.category,
    p.code,
    p.created_at,
    COALESCE(p.description, '') AS description,
    p.id,
    p.is_system,
    p.name,
    p.updated_at
  FROM public.permissions p
  ORDER BY p.category, p.name;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_permissions_catalog_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_permissions_catalog_admin() TO authenticated;
