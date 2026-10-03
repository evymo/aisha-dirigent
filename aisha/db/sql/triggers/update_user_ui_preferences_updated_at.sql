-- Trigger: update_user_ui_preferences_updated_at
-- Table: public.user_ui_preferences

CREATE TRIGGER update_user_ui_preferences_updated_at
  BEFORE UPDATE ON public.user_ui_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
