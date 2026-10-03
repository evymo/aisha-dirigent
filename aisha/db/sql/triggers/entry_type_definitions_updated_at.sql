-- Trigger: entry_type_definitions_updated_at
-- Keeps entry_type_definitions.updated_at fresh on every UPDATE (the upserts in
-- the entry-type seed touch it). Mirrors the stack's standard set_updated_at().

DROP TRIGGER IF EXISTS entry_type_definitions_updated_at ON public.entry_type_definitions;
CREATE TRIGGER entry_type_definitions_updated_at
  BEFORE UPDATE ON public.entry_type_definitions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
