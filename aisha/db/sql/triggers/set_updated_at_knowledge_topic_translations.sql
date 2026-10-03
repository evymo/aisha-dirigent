-- Trigger: set_updated_at_knowledge_topic_translations
-- Table: knowledge_topic_translations

CREATE TRIGGER set_updated_at_knowledge_topic_translations
    BEFORE UPDATE ON public.knowledge_topic_translations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
