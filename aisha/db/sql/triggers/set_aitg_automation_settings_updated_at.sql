-- Trigger: set_aitg_automation_settings_updated_at
-- Pairs with aitg_automation_settings.updated_at column. The audited RPC
-- aitg_update_automation_audited writes updated_at explicitly, but any
-- direct UPDATE (admin SQL session, etc.) gets the same auto-bump.

CREATE TRIGGER set_aitg_automation_settings_updated_at
  BEFORE UPDATE ON public.aitg_automation_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
