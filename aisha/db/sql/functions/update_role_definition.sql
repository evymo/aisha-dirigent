-- Function: public.update_role_definition
-- Arguments: p_role_id uuid, p_display_name text, p_description text, p_can_manage_users boolean, p_can_manage_roles boolean, p_can_view_phi boolean
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:26+01:00

CREATE OR REPLACE FUNCTION public.update_role_definition(p_role_id uuid, p_display_name text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_can_manage_users boolean DEFAULT NULL::boolean, p_can_manage_roles boolean DEFAULT NULL::boolean, p_can_view_phi boolean DEFAULT NULL::boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role_name text;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT role_name INTO v_role_name FROM role_definitions WHERE id = p_role_id;
  IF v_role_name IS NULL THEN
    RAISE EXCEPTION 'Role not found';
  END IF;

  UPDATE role_definitions SET
    display_name = COALESCE(p_display_name, display_name),
    description = COALESCE(p_description, description),
    updated_at = now()
  WHERE id = p_role_id;

  RETURN true;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_role_definition(p_role_id uuid, p_display_name text, p_description text, p_can_manage_users boolean, p_can_manage_roles boolean, p_can_view_phi boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_role_definition(p_role_id uuid, p_display_name text, p_description text, p_can_manage_users boolean, p_can_manage_roles boolean, p_can_view_phi boolean) TO authenticated;
