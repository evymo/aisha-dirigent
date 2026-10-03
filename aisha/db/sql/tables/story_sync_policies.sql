-- Table: story_sync_policies
-- Per-story sync policy: data classification and flow direction per domain

CREATE TABLE IF NOT EXISTS public.story_sync_policies (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  story_id uuid NOT NULL,
  data_domain text NOT NULL,
  data_class sync_data_class NOT NULL,
  flow_direction sync_flow_direction NOT NULL,
  description text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT story_sync_policies_story_id_fkey
    FOREIGN KEY (story_id) REFERENCES partner_stories(id) ON DELETE CASCADE,
  CONSTRAINT story_sync_policies_unique_domain
    UNIQUE (story_id, data_domain)
);

ALTER TABLE public.story_sync_policies ENABLE ROW LEVEL SECURITY;
