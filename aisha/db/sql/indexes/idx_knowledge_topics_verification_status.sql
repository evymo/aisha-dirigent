-- Index: idx_knowledge_topics_verification_status
-- Table: knowledge_topics

CREATE INDEX IF NOT EXISTS idx_knowledge_topics_verification_status
  ON knowledge_topics (verification_status);

-- knowledge_posts
