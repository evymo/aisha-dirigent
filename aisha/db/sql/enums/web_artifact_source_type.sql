-- Web Artifact Source Type Enum
-- Where did the artifact come from: operator upload, URL scrape, manual edit, default seed, LLM redesign
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'web_artifact_source_type') THEN
    CREATE TYPE web_artifact_source_type AS ENUM (
      'folder_upload',
      'url_scrape',
      'manual',
      'default_seed',
      'llm_redesign'
    );
  END IF;
END $$;
