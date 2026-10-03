-- Function: audience_audit_grants

CREATE OR REPLACE FUNCTION public.audience_audit_grants()
 RETURNS TABLE(severity text, invariant text, object_type text, object_name text, role_name text, problem text, fix_sql text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Functions only the broker may write through (must NOT be reachable by
  -- `authenticated` or anon). Keep in sync with 20260524140000.
  v_broker_only TEXT[] := ARRAY[
    'audience_upsert_user_engagement',
    'audience_process_signal_audited',
    'audience_broker_record_sync'
  ];
  v_has_anon BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon');
  v_has_authd BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated');
  v_has_svc BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role');
  v_has_broker BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname='svc_source_broker_writer');
BEGIN
  -- ── I1: PUBLIC EXECUTE on audience functions (incl. NULL acl = default) ──
  RETURN QUERY
  SELECT
    'CRITICAL', 'I1_public_execute', 'function',
    format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)),
    'PUBLIC',
    CASE WHEN p.proacl IS NULL
         THEN 'proacl IS NULL → Postgres default grants PUBLIC EXECUTE'
         ELSE 'explicit PUBLIC EXECUTE grant' END,
    format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC;',
           p.proname, pg_get_function_identity_arguments(p.oid))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'audience%'
    AND ( p.proacl IS NULL
          OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                     WHERE a.grantee = 0 AND a.privilege_type='EXECUTE') );

  -- ── I2: anon EXECUTE on audience functions ──────────────────────────────
  IF v_has_anon THEN
    RETURN QUERY
    SELECT
      'CRITICAL', 'I2_anon_execute', 'function',
      format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)),
      'anon', 'anon can EXECUTE (SECURITY DEFINER → RLS bypass)',
      format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon;',
             p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'audience%'
      AND has_function_privilege('anon', p.oid, 'EXECUTE');
  END IF;

  -- ── I3: anon SELECT on audience views/tables + cohorts* ─────────────────
  IF v_has_anon THEN
    RETURN QUERY
    SELECT
      'CRITICAL', 'I3_anon_select', 'relation',
      g.table_name::text, 'anon',
      'anon can SELECT a privileged audience relation',
      format('REVOKE SELECT ON public.%I FROM anon;', g.table_name)
    FROM information_schema.role_table_grants g
    WHERE g.table_schema='public' AND g.grantee='anon' AND g.privilege_type='SELECT'
      AND (g.table_name LIKE 'audience%' OR g.table_name IN ('cohorts','cohort_arms'));
  END IF;

  -- ── I4: authenticated EXECUTE on broker-only write functions ────────────
  IF v_has_authd THEN
    RETURN QUERY
    SELECT
      'HIGH', 'I4_authd_broker_write', 'function',
      format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)),
      'authenticated',
      'logged-in marketer can EXECUTE a broker-only write function',
      format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM authenticated;',
             p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname = ANY(v_broker_only)
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  END IF;

  -- ── I5: service_role MISSING EXECUTE on an audience function (under-grant)
  IF v_has_svc THEN
    RETURN QUERY
    SELECT
      'MEDIUM', 'I5_service_role_missing', 'function',
      format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)),
      'service_role', 'admin role lacks EXECUTE (audience admin path broken)',
      format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role;',
             p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'audience%'
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE');
  END IF;

  -- ── I6: broker writer MISSING EXECUTE on a broker-write fn (under-grant) ─
  IF v_has_broker THEN
    RETURN QUERY
    SELECT
      'MEDIUM', 'I6_broker_writer_missing', 'function',
      format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)),
      'svc_source_broker_writer', 'broker role lacks EXECUTE (sync broken)',
      format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO svc_source_broker_writer;',
             p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname = ANY(v_broker_only)
      AND NOT has_function_privilege('svc_source_broker_writer', p.oid, 'EXECUTE');
  END IF;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_audit_grants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_audit_grants() TO service_role;
