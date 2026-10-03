-- Function: aisha_assert_definer_grants
-- Auto-extracted (back-port reconciliation)

CREATE OR REPLACE FUNCTION public.aisha_assert_definer_grants()
 RETURNS TABLE(schema_name text, function_ident text, grantee text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    n.nspname::text AS schema_name,
    (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')::text
      AS function_ident,
    COALESCE((SELECT r.rolname FROM pg_roles r WHERE r.oid = a.grantee), 'PUBLIC')::text
      AS grantee
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  -- COALESCE to acldefault so functions that NEVER had an explicit grant/revoke
  -- (NULL proacl == Postgres default == EXECUTE TO PUBLIC) are still surfaced.
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f'::"char", p.proowner))) AS a
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND p.prosecdef = true                       -- SECURITY DEFINER only
    AND a.privilege_type = 'EXECUTE'
    AND (
      a.grantee = 0                              -- 0 == the PUBLIC pseudo-role
      OR a.grantee = (SELECT r.oid FROM pg_roles r WHERE r.rolname = 'anon')
    )
  ORDER BY 1, 2, 3
$function$
;

REVOKE ALL ON FUNCTION aisha_assert_definer_grants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aisha_assert_definer_grants() TO service_role;
