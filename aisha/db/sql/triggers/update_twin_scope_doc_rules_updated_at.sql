-- Trigger: update_twin_scope_doc_rules_updated_at
-- Table: twin_scope_doc_rules (idempotentní — přehrává ho heals)

DROP TRIGGER IF EXISTS update_twin_scope_doc_rules_updated_at ON public.twin_scope_doc_rules;
CREATE TRIGGER update_twin_scope_doc_rules_updated_at
    BEFORE UPDATE ON public.twin_scope_doc_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
