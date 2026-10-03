-- Index: idx_knowledge_topic_links_topic_id
-- Table: knowledge_topic_links

CREATE INDEX IF NOT EXISTS idx_knowledge_topic_links_topic_id
  ON knowledge_topic_links (topic_id);

-- knowledge_topic_versions
