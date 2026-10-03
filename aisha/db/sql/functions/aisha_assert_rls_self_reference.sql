-- Function: aisha_assert_rls_self_reference
-- Auto-extracted (back-port reconciliation)

CREATE OR REPLACE FUNCTION public.aisha_assert_rls_self_reference()
 RETURNS TABLE(table_ident text, policy_name text, clause text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- pg_policies.qual / .with_check hold the EXPANDED expression text, in which
  -- Postgres rewrites every column reference as `tablename.column`. So a policy
  -- that merely filters on its OWN columns (the normal, safe case) ALWAYS names
  -- its table -- a naked `\mtablename\M` match flags all of them (~80% false
  -- positives observed: 20 hits, only 4 real). The actual 42P17 recursion risk
  -- is narrower: the own table appearing in a FROM / JOIN, i.e. a SUBQUERY that
  -- re-enters the table's own policies. We anchor the match to
  -- `(FROM|JOIN) [schema.]tablename` so own-column refs (`tablename.col`) are
  -- excluded while real self-subqueries are caught. A policy that delegates to a
  -- SECURITY DEFINER helper never names its own table in a FROM/JOIN -- which is
  -- exactly why the helper fix breaks the recursion. (Keyword case is stable:
  -- Postgres deparse upper-cases FROM/JOIN in the stored expression.)
  SELECT
    (pol.schemaname || '.' || pol.tablename)::text AS table_ident,
    pol.policyname::text                           AS policy_name,
    (CASE
       WHEN pol.qual ~ ('\m(FROM|JOIN)\s+(ONLY\s+)?(' || pol.schemaname || '\.)?' || pol.tablename || '\M')
         THEN 'USING'
       ELSE 'WITH CHECK'
     END)::text                                    AS clause
  FROM pg_policies pol
  WHERE pol.schemaname NOT IN ('pg_catalog', 'information_schema')
    AND (
      pol.qual       ~ ('\m(FROM|JOIN)\s+(ONLY\s+)?(' || pol.schemaname || '\.)?' || pol.tablename || '\M')
      OR pol.with_check ~ ('\m(FROM|JOIN)\s+(ONLY\s+)?(' || pol.schemaname || '\.)?' || pol.tablename || '\M')
    )
  ORDER BY 1, 2
$function$
;

REVOKE ALL ON FUNCTION aisha_assert_rls_self_reference() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aisha_assert_rls_self_reference() TO service_role;
