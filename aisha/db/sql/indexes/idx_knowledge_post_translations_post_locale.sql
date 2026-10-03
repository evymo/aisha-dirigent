-- Index: idx_knowledge_post_translations_post_locale
-- Table: knowledge_post_translations

CREATE INDEX IF NOT EXISTS idx_knowledge_post_translations_post_locale
  ON knowledge_post_translations (post_id, locale);

-- knowledge_topic_links
