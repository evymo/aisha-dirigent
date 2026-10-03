-- Trigger: auto-touch updated_at on audience_broker_sync_state (universal updated_at convention)
CREATE TRIGGER set_updated_at_audience_broker_sync_state
  BEFORE UPDATE ON public.audience_broker_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
