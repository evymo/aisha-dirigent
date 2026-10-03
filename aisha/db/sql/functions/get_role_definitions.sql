-- Function: public.get_role_definitions
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:28+01:00

CREATE OR REPLACE FUNCTION public.get_role_definitions()
 RETURNS TABLE(can_break_glass boolean, can_export_phi boolean, can_manage_roles boolean, can_manage_users boolean, can_view_phi boolean, created_at timestamptz, description text, display_name text, id uuid, is_admin boolean, is_system boolean, role_name text, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Require admin or staff
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  RETURN QUERY
  SELECT 
    COALESCE(rd.can_break_glass, false) AS can_break_glass,
    COALESCE(rd.can_export_phi, false) AS can_export_phi,
    COALESCE(rd.can_manage_roles, false) AS can_manage_roles,
    COALESCE(rd.can_manage_users, false) AS can_manage_users,
    COALESCE(rd.can_view_phi, false) AS can_view_phi,
    rd.created_at,
    COALESCE(rd.description, '') AS description,
    rd.display_name,
    rd.id,
    COALESCE(rd.is_admin, false) AS is_admin,
    rd.is_system,
    rd.role_name,
    rd.updated_at
  FROM public.role_definitions rd
  ORDER BY rd.display_name;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_role_definitions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_role_definitions() TO authenticated;
