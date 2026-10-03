-- Trigger: update_knowledge_topic_links_updated_at
CREATE TRIGGER update_knowledge_topic_links_updated_at
  BEFORE UPDATE ON knowledge_topic_links
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();