-- Index: idx_knowledge_moderation_queue_status
-- Table: knowledge_moderation_queue

CREATE INDEX IF NOT EXISTS idx_knowledge_moderation_queue_status
  ON knowledge_moderation_queue (status);
