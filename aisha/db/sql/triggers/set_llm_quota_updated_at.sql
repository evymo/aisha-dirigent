-- Trigger: set_llm_quota_updated_at
-- Pairs with llm_quota.updated_at column. The audited RPC
-- fn_check_and_consume_llm_quota_audited writes updated_at explicitly,
-- but any direct UPDATE (admin SQL session, etc.) gets the same auto-bump.
-- Phase 12 WP 2.3.

CREATE TRIGGER set_llm_quota_updated_at
  BEFORE UPDATE ON public.llm_quota
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
