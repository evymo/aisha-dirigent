-- Trigger: surface_scope_axes_updated_at
DROP TRIGGER IF EXISTS surface_scope_axes_updated_at ON public.surface_scope_axes;
CREATE TRIGGER surface_scope_axes_updated_at
  BEFORE UPDATE ON public.surface_scope_axes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
