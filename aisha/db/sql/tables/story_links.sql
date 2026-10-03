-- Table: story_links
-- Cross-story relationship graph for collaboration network.
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS public.story_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_story_id uuid NOT NULL,
  target_story_id uuid NOT NULL,
  link_type text NOT NULL CHECK (link_type IN ('depends_on', 'related_to', 'blocks', 'extends', 'shares_context')),
  link_direction text NOT NULL DEFAULT 'bidirectional' CHECK (link_direction IN ('forward', 'backward', 'bidirectional')),
  created_by uuid,
  created_by_agent text,
  confidence_score numeric(3,2) CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_accepted boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT story_links_source_fkey FOREIGN KEY (source_story_id) REFERENCES public.partner_stories(id) ON DELETE CASCADE,
  CONSTRAINT story_links_target_fkey FOREIGN KEY (target_story_id) REFERENCES public.partner_stories(id) ON DELETE CASCADE,
  CONSTRAINT story_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  CONSTRAINT story_links_no_self_link CHECK (source_story_id <> target_story_id),
  CONSTRAINT story_links_unique_pair UNIQUE (source_story_id, target_story_id, link_type)
);

ALTER TABLE public.story_links ENABLE ROW LEVEL SECURITY;
