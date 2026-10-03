-- Web Artifact Kind Enum
-- What lifecycle step this job represents. Extensible — future kinds: deploy_artifact, doc_artifact, dataset_artifact
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'web_artifact_kind') THEN
    CREATE TYPE web_artifact_kind AS ENUM (
      'ingest_upload',
      'ingest_scrape',
      'redesign',
      'apply'
    );
  END IF;
END $$;
