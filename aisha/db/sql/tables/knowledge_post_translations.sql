-- Table: knowledge_post_translations
-- Per-locale auto-translated versions of knowledge posts
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS knowledge_post_translations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL,
  locale text NOT NULL,
  body_translated text NOT NULL,
  provider text,
  model text,
  token_count integer,
  quality_score numeric,
  is_human_reviewed boolean DEFAULT false,
  source_hash text,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT knowledge_post_translations_post_id_fkey FOREIGN KEY (post_id) REFERENCES knowledge_posts(id) ON DELETE CASCADE,
  CONSTRAINT knowledge_post_translations_locale_fkey FOREIGN KEY (locale) REFERENCES supported_languages(code) ON DELETE CASCADE,
  CONSTRAINT knowledge_post_translations_post_locale_key UNIQUE (post_id, locale)
);

ALTER TABLE knowledge_post_translations ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT ON knowledge_post_translations TO authenticated;
GRANT ALL ON knowledge_post_translations TO service_role;
