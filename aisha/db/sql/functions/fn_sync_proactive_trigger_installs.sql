-- Function: fn_sync_proactive_trigger_installs
-- Meta-trigger on ai_proactive_trigger_definitions: whenever a reactive rule is
-- inserted/updated/deleted, reconcile the dispatch trigger on the affected source
-- table(s). This is what makes reactivity DATA — add an active rule row and the
-- generic dispatch trigger appears on its source_table automatically; deactivate or
-- delete the last rule for a table and it is removed. No migration per rule.

CREATE OR REPLACE FUNCTION public.fn_sync_proactive_trigger_installs()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM fn_apply_proactive_dispatch_install(OLD.source_table);
    RETURN OLD;
  END IF;

  -- INSERT / UPDATE
  PERFORM fn_apply_proactive_dispatch_install(NEW.source_table);
  -- If a rule was re-pointed to a different table, reconcile the old one too.
  IF TG_OP = 'UPDATE' AND NEW.source_table IS DISTINCT FROM OLD.source_table THEN
    PERFORM fn_apply_proactive_dispatch_install(OLD.source_table);
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION fn_sync_proactive_trigger_installs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_sync_proactive_trigger_installs() TO service_role;
