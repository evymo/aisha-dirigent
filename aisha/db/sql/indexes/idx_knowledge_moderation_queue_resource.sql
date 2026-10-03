-- Index: idx_knowledge_moderation_queue_resource
-- Table: knowledge_moderation_queue

CREATE INDEX IF NOT EXISTS idx_knowledge_moderation_queue_resource
  ON knowledge_moderation_queue (resource_type, resource_id);
