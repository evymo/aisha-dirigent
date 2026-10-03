-- Index: idx_knowledge_topic_versions_topic_id
-- Table: knowledge_topic_versions

CREATE INDEX IF NOT EXISTS idx_knowledge_topic_versions_topic_id
  ON knowledge_topic_versions (topic_id, version_no DESC);

-- knowledge_moderation_queue
