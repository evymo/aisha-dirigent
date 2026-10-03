-- Trigger: trg_blockchain_audit_chain_link
-- BEFORE INSERT: fills previous_hash from the chain tip and computes the
-- deterministic chained record_hash (fn_blockchain_audit_chain_link).

DROP TRIGGER IF EXISTS trg_blockchain_audit_chain_link ON public.blockchain_audit_records;
CREATE TRIGGER trg_blockchain_audit_chain_link
  BEFORE INSERT ON public.blockchain_audit_records
  FOR EACH ROW
  EXECUTE FUNCTION fn_blockchain_audit_chain_link();
