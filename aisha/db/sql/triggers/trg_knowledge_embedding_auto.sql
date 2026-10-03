-- Trigger: trg_knowledge_embedding_auto
-- Auto-queue embedding generation when knowledge_items content changes.
-- Fires fn_queue_embedding_generation() which:
--   1. Sends pg_notify on 'kb_embedding_sync' channel
--   2. Calls generate-knowledge-embeddings edge function via pg_net (if configured)
--   3. Logs to audit_journal

CREATE TRIGGER trg_knowledge_embedding_auto
  AFTER INSERT OR UPDATE ON public.knowledge_items
  FOR EACH ROW
  EXECUTE FUNCTION fn_queue_embedding_generation();
