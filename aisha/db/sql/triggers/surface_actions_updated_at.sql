-- Trigger: surface_actions_updated_at
DROP TRIGGER IF EXISTS surface_actions_updated_at ON public.surface_actions;
CREATE TRIGGER surface_actions_updated_at
  BEFORE UPDATE ON public.surface_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
