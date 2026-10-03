-- Trigger: update_knowledge_moderation_queue_updated_at
CREATE TRIGGER update_knowledge_moderation_queue_updated_at
  BEFORE UPDATE ON knowledge_moderation_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();