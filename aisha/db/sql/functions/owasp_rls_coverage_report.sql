-- ============================================================================
-- Source of Truth: owasp_rls_coverage_report
--
-- OWASP A01 — produces a coverage report of RLS enforcement across all user-
-- facing tables in the `public` schema. Returns one row per table with:
--   - has_rls       — whether ALTER TABLE … ENABLE ROW LEVEL SECURITY is set
--   - policy_count  — number of CREATE POLICY entries
--   - is_force_rls  — whether RLS bypass is denied even to table owners
--   - gap_reason    — null if compliant, otherwise short diagnostic message
--
-- Intended consumers:
--   1. CI gate test (src/tests/gates/owasp-rls-coverage.gate.test.ts) — fails
--      the build when a new table is added without RLS or policies.
--   2. Admin dashboard panel — operator visibility into the security posture.
--
-- Authorization: admin/staff only (sensitive infrastructure metadata).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.owasp_rls_coverage_report()
RETURNS TABLE (
  table_name    text,
  has_rls       boolean,
  is_force_rls  boolean,
  policy_count  integer,
  gap_reason    text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff required';
  END IF;

  RETURN QUERY
  SELECT
    t.tablename::text                                                AS table_name,
    c.relrowsecurity                                                 AS has_rls,
    c.relforcerowsecurity                                            AS is_force_rls,
    COALESCE(p.policy_count, 0)::int                                 AS policy_count,
    CASE
      WHEN NOT c.relrowsecurity THEN 'rls_disabled'
      WHEN COALESCE(p.policy_count, 0) = 0 THEN 'no_policies'
      WHEN c.relrowsecurity AND NOT c.relforcerowsecurity AND t.tableowner = 'postgres' THEN 'rls_bypassable_by_owner'
      ELSE NULL
    END                                                              AS gap_reason
  FROM pg_tables t
  JOIN pg_class c ON c.relname = t.tablename AND c.relkind = 'r'
  LEFT JOIN (
    SELECT polrelid, COUNT(*)::int AS policy_count
    FROM pg_policy
    GROUP BY polrelid
  ) p ON p.polrelid = c.oid
  WHERE t.schemaname = 'public'
  ORDER BY (CASE WHEN c.relrowsecurity THEN 1 ELSE 0 END), t.tablename;
END;
$$;

REVOKE ALL ON FUNCTION public.owasp_rls_coverage_report() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owasp_rls_coverage_report() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owasp_rls_coverage_report() TO service_role;
