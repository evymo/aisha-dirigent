-- Trigger: set_llm_tier_defaults_updated_at
-- Pairs with llm_tier_defaults.updated_at column. Tier definitions are
-- admin-managed; the auto-bump ensures any direct UPDATE refreshes the
-- timestamp without relying on the caller setting it explicitly.
-- Phase 12 WP 2.3.

CREATE TRIGGER set_llm_tier_defaults_updated_at
  BEFORE UPDATE ON public.llm_tier_defaults
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
