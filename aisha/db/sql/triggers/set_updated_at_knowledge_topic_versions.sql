-- Trigger: set_updated_at_knowledge_topic_versions
-- Table: knowledge_topic_versions

CREATE TRIGGER set_updated_at_knowledge_topic_versions
    BEFORE UPDATE ON public.knowledge_topic_versions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
