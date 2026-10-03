-- Index: idx_knowledge_posts_created_at
-- Table: knowledge_posts

CREATE INDEX IF NOT EXISTS idx_knowledge_posts_created_at
  ON knowledge_posts (created_at DESC);
