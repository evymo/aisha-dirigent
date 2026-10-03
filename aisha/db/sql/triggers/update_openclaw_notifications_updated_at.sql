-- Trigger: update_openclaw_notifications_updated_at
-- Maintains updated_at on openclaw_notifications row mutations (Phase 2B OpenClaw notify).

CREATE TRIGGER update_openclaw_notifications_updated_at
  BEFORE UPDATE ON public.openclaw_notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
