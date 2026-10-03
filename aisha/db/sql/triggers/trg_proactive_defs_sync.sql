-- Trigger: trg_proactive_defs_sync
-- Keeps the generic proactive dispatch trigger in sync with the reactive rules:
-- inserting/updating/deleting an ai_proactive_trigger_definitions row installs or removes
-- trg_proactive_dispatch on the affected source_table(s). Reactivity is data.

CREATE TRIGGER trg_proactive_defs_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.ai_proactive_trigger_definitions
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_proactive_trigger_installs();
