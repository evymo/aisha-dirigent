-- Trigger: update_li_entity_suggestions_updated_at
-- Table: li_entity_suggestions

CREATE TRIGGER update_li_entity_suggestions_updated_at
    BEFORE UPDATE ON public.li_entity_suggestions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
