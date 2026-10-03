-- Trigger: update_knowledge_topics_updated_at
CREATE TRIGGER update_knowledge_topics_updated_at
  BEFORE UPDATE ON knowledge_topics
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();