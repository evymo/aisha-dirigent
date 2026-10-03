-- Trigger: trg_protect_psyche_traits
-- Auto-extracted (back-port reconciliation)

CREATE TRIGGER trg_protect_psyche_traits BEFORE DELETE OR UPDATE ON public.knowledge_items FOR EACH ROW EXECUTE FUNCTION fn_protect_psyche_traits();
