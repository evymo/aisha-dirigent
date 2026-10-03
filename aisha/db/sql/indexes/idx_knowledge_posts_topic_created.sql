-- Index: idx_knowledge_posts_topic_created
-- Table: knowledge_posts

CREATE INDEX IF NOT EXISTS idx_knowledge_posts_topic_created
  ON knowledge_posts (topic_id, created_at DESC);

-- knowledge_post_translations
