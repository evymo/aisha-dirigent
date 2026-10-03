-- Trigger: trg_study_consultants_validate_scope_fk
-- Auto-extracted (back-port reconciliation)

CREATE TRIGGER trg_study_consultants_validate_scope_fk BEFORE INSERT OR UPDATE ON public.study_consultants FOR EACH ROW EXECUTE FUNCTION audience_study_consultants_validate_scope_fk();
