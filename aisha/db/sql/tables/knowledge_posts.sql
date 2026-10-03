-- Table: knowledge_posts
-- Community discussion posts within knowledge topics
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS knowledge_posts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL,
  author_user_id uuid NOT NULL,
  body_original text NOT NULL,
  original_locale text NOT NULL DEFAULT 'en',
  status text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden','flagged','deleted')),
  moderation_reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT knowledge_posts_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES knowledge_topics(id) ON DELETE CASCADE,
  CONSTRAINT knowledge_posts_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES aisha_auth.users(id)
);

ALTER TABLE knowledge_posts ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT ON knowledge_posts TO authenticated;
GRANT ALL ON knowledge_posts TO service_role;
