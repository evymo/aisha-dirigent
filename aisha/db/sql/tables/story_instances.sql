-- Table: story_instances
-- Registry of environments materializing a story

CREATE TABLE IF NOT EXISTS public.story_instances (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  story_id uuid NOT NULL,
  instance_label text NOT NULL,
  instance_type text NOT NULL DEFAULT 'self-hosted',
  is_origin boolean NOT NULL DEFAULT false,
  schema_version text,
  last_bundle_version integer DEFAULT 0,
  last_sync_at timestamptz,
  endpoint_profile_key text,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT story_instances_story_id_fkey
    FOREIGN KEY (story_id) REFERENCES partner_stories(id) ON DELETE CASCADE
);

ALTER TABLE public.story_instances ENABLE ROW LEVEL SECURITY;
