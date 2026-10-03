-- Index: idx_knowledge_topics_visibility
-- Table: knowledge_topics

CREATE INDEX IF NOT EXISTS idx_knowledge_topics_visibility
  ON knowledge_topics (visibility);
