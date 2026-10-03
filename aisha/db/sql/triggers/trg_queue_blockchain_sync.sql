-- Trigger: trg_queue_blockchain_sync
-- Auto-extracted (back-port reconciliation)

CREATE TRIGGER trg_queue_blockchain_sync AFTER INSERT ON public.token_transactions FOR EACH ROW EXECUTE FUNCTION fn_queue_blockchain_sync();
