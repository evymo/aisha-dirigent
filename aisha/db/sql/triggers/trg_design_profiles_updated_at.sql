-- Trigger: trg_design_profiles_updated_at
-- Auto-extracted (back-port reconciliation)

CREATE TRIGGER trg_design_profiles_updated_at BEFORE UPDATE ON public.design_profiles FOR EACH ROW EXECUTE FUNCTION fn_design_profiles_updated_at();
