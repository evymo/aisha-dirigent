-- Trigger: update_li_relation_suggestions_updated_at
-- Table: li_relation_suggestions

CREATE TRIGGER update_li_relation_suggestions_updated_at
    BEFORE UPDATE ON public.li_relation_suggestions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
