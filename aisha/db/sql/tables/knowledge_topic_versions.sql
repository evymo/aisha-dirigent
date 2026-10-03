-- Table: knowledge_topic_versions
-- Versioned body content for knowledge topics
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS knowledge_topic_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL,
  version_no int NOT NULL DEFAULT 1,
  body_markdown text NOT NULL,
  change_note text,
  approved_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT knowledge_topic_versions_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES knowledge_topics(id) ON DELETE CASCADE,
  CONSTRAINT knowledge_topic_versions_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE knowledge_topic_versions ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT ON knowledge_topic_versions TO anon;
GRANT SELECT ON knowledge_topic_versions TO authenticated;
GRANT ALL ON knowledge_topic_versions TO service_role;
