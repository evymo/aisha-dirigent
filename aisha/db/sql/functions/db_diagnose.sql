-- Function: public.db_diagnose
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:20+01:00

CREATE OR REPLACE FUNCTION public.db_diagnose()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_issues jsonb := '[]'::jsonb;
  v_tables_without_rls INTEGER;
BEGIN
  -- Check extensions
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    v_issues := v_issues || jsonb_build_object(
      'severity', 'critical',
      'type', 'extension',
      'message', 'pgcrypto extension is missing'
    );
  END IF;

  -- Check RLS
  SELECT COUNT(*) INTO v_tables_without_rls
  FROM pg_tables t
  LEFT JOIN pg_class c ON t.tablename = c.relname AND c.relnamespace = 'public'::regnamespace
  WHERE t.schemaname = 'public'
  AND t.tablename NOT LIKE 'pg_%'
  AND (c.relrowsecurity IS NULL OR c.relrowsecurity = false);

  IF v_tables_without_rls > 0 THEN
    v_issues := v_issues || jsonb_build_object(
      'severity', 'critical',
      'type', 'security',
      'message', format('%s tables without RLS enabled', v_tables_without_rls)
    );
  END IF;

  -- Check required roles
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'admin') THEN
    v_issues := v_issues || jsonb_build_object(
      'severity', 'high',
      'type', 'data',
      'message', 'Admin role is missing'
    );
  END IF;

  -- Return result
  RETURN jsonb_build_object(
    'healthy', jsonb_array_length(v_issues) = 0,
    'issues_count', jsonb_array_length(v_issues),
    'issues', v_issues,
    'checked_at', NOW()
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.db_diagnose() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.db_diagnose() TO authenticated;
