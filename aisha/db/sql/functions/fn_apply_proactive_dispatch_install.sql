-- Function: fn_apply_proactive_dispatch_install
-- Reconcile the presence of the generic proactive dispatch trigger on ONE source table
-- against whether any ACTIVE ai_proactive_trigger_definitions row still references it.
--
--   any active rule for table  +  trigger absent  → CREATE TRIGGER
--   no active rule for table    +  trigger present → DROP TRIGGER
--
-- Injection-safe: the table name is validated via to_regclass (must be a real relation)
-- and only ever interpolated with format('%I'). Unknown tables are skipped silently so a
-- typo in a rule can never error the caller. SECURITY DEFINER because it issues DDL.

CREATE OR REPLACE FUNCTION public.fn_apply_proactive_dispatch_install(p_source_table text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_has_active     boolean;
  v_trigger_exists boolean;
BEGIN
  IF p_source_table IS NULL OR p_source_table = '' THEN
    RETURN;
  END IF;

  -- Validate: must be a real relation in `public` (injection-safe gate).
  IF to_regclass('public.' || quote_ident(p_source_table)) IS NULL THEN
    RAISE WARNING 'proactive: source_table public.% does not exist — dispatch trigger not installed', p_source_table;
    RETURN;
  END IF;

  v_has_active := EXISTS (
    SELECT 1 FROM ai_proactive_trigger_definitions
    WHERE source_table = p_source_table AND is_active = true
  );

  v_trigger_exists := EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c     ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = p_source_table
      AND t.tgname  = 'trg_proactive_dispatch'
  );

  IF v_has_active AND NOT v_trigger_exists THEN
    EXECUTE format(
      'CREATE TRIGGER trg_proactive_dispatch AFTER INSERT OR UPDATE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION fn_dispatch_proactive_triggers()',
      p_source_table
    );
    RAISE NOTICE 'proactive: installed trg_proactive_dispatch on public.%', p_source_table;
  ELSIF NOT v_has_active AND v_trigger_exists THEN
    EXECUTE format('DROP TRIGGER IF EXISTS trg_proactive_dispatch ON public.%I', p_source_table);
    RAISE NOTICE 'proactive: removed trg_proactive_dispatch from public.%', p_source_table;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION fn_apply_proactive_dispatch_install(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_apply_proactive_dispatch_install(text) TO service_role;
