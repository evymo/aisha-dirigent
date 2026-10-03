-- Trigger: trg_knowledge_ragnarok_sync
-- Fires fn_notify_knowledge_change() on knowledge_items changes
-- to keep Ragnarok search index in sync with Supabase admin edits.

CREATE TRIGGER trg_knowledge_ragnarok_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.knowledge_items
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_knowledge_change();
