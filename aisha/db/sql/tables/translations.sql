-- Table: translations
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS translations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  locale text NOT NULL,
  namespace text NOT NULL DEFAULT 'common'::text,
  key text NOT NULL,
  value text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  source_updated_at timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT translations_locale_namespace_key_key UNIQUE (key, namespace, locale),
  CONSTRAINT translations_locale_fkey FOREIGN KEY (locale) REFERENCES supported_languages(code) ON DELETE CASCADE
);

ALTER TABLE translations ENABLE ROW LEVEL SECURITY;

-- Grants: public translations
GRANT SELECT ON translations TO anon;
GRANT SELECT ON translations TO authenticated;
GRANT ALL ON translations TO service_role;
