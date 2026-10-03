-- Trigger: trg_study_consultants_default_scope
-- Auto-extracted (back-port reconciliation)

CREATE TRIGGER trg_study_consultants_default_scope BEFORE INSERT ON public.study_consultants FOR EACH ROW EXECUTE FUNCTION audience_study_consultants_default_scope();
