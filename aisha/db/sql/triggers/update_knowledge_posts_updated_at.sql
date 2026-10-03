-- Trigger: update_knowledge_posts_updated_at
CREATE TRIGGER update_knowledge_posts_updated_at
  BEFORE UPDATE ON knowledge_posts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();