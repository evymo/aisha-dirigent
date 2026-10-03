-- Trigger: surface_blocks_updated_at
-- Source of truth pair: aisha/db/sql/tables/surface_blocks.sql

DROP TRIGGER IF EXISTS surface_blocks_updated_at ON public.surface_blocks;
CREATE TRIGGER surface_blocks_updated_at
  BEFORE UPDATE ON public.surface_blocks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
