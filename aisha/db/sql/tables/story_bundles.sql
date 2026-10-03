-- Table: story_bundles
-- Versioned portable story snapshots for materialization

CREATE TABLE IF NOT EXISTS public.story_bundles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  story_id uuid NOT NULL,
  bundle_version integer NOT NULL,
  ruleset_fingerprint text NOT NULL,
  schema_version text NOT NULL,
  portable_manifest jsonb NOT NULL,
  bundle_manifest_hash text,
  artifact_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  exported_by text NOT NULL DEFAULT 'aisha',
  exported_from_instance_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT story_bundles_story_id_fkey
    FOREIGN KEY (story_id) REFERENCES partner_stories(id) ON DELETE CASCADE,
  CONSTRAINT story_bundles_unique_version
    UNIQUE (story_id, bundle_version),
  CONSTRAINT story_bundles_exported_from_fkey
    FOREIGN KEY (exported_from_instance_id) REFERENCES story_instances(id) ON DELETE SET NULL
);

ALTER TABLE public.story_bundles ENABLE ROW LEVEL SECURITY;
