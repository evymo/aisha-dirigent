-- Trigger: set_coolify_app_slots_updated_at

CREATE TRIGGER set_coolify_app_slots_updated_at
  BEFORE UPDATE ON public.coolify_app_slots
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
