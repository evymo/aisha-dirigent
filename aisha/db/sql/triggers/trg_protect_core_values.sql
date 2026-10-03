-- Trigger: trg_protect_core_values
-- Auto-extracted (back-port reconciliation)

CREATE TRIGGER trg_protect_core_values BEFORE DELETE OR UPDATE ON public.knowledge_items FOR EACH ROW EXECUTE FUNCTION fn_protect_core_values();
