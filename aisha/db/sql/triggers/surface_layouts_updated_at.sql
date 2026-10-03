-- Trigger: surface_layouts_updated_at
-- Source of truth pair: aisha/db/sql/tables/surface_layouts.sql

DROP TRIGGER IF EXISTS surface_layouts_updated_at ON public.surface_layouts;
CREATE TRIGGER surface_layouts_updated_at
  BEFORE UPDATE ON public.surface_layouts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
