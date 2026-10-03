-- Function: fn_reconcile_proactive_dispatch_installs
-- Idempotent full reconcile of dispatch triggers across every table referenced by an
-- ACTIVE rule, plus removal of any stale trg_proactive_dispatch left on tables that no
-- longer have an active rule. Safe to run any number of times; intended for cold-start
-- (post-seed) and operational healing after a table is recreated. Returns the count of
-- tables that now carry the dispatch trigger.

CREATE OR REPLACE FUNCTION public.fn_reconcile_proactive_dispatch_installs()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_table text;
  v_count integer := 0;
BEGIN
  -- Tables that SHOULD have the trigger (any active rule).
  FOR v_table IN
    SELECT DISTINCT source_table FROM ai_proactive_trigger_definitions WHERE is_active = true
  LOOP
    PERFORM fn_apply_proactive_dispatch_install(v_table);
  END LOOP;

  -- Tables that currently HAVE the trigger but no longer have an active rule → remove.
  FOR v_table IN
    SELECT c.relname
    FROM pg_trigger t
    JOIN pg_class c     ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND t.tgname  = 'trg_proactive_dispatch'
      AND NOT EXISTS (
        SELECT 1 FROM ai_proactive_trigger_definitions d
        WHERE d.source_table = c.relname AND d.is_active = true
      )
  LOOP
    PERFORM fn_apply_proactive_dispatch_install(v_table);
  END LOOP;

  SELECT count(*) INTO v_count
  FROM pg_trigger t
  JOIN pg_class c     ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND t.tgname = 'trg_proactive_dispatch';

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION fn_reconcile_proactive_dispatch_installs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_reconcile_proactive_dispatch_installs() TO service_role;
