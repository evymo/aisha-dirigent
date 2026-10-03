-- Index: idx_knowledge_posts_topic_id
-- Table: knowledge_posts

CREATE INDEX IF NOT EXISTS idx_knowledge_posts_topic_id
  ON knowledge_posts (topic_id);
