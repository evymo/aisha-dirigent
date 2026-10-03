-- Index: idx_knowledge_posts_status
-- Table: knowledge_posts

CREATE INDEX IF NOT EXISTS idx_knowledge_posts_status
  ON knowledge_posts (status);
