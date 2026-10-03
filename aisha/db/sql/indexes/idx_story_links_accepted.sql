-- Index: idx_story_links_accepted
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_story_links_accepted ON public.story_links (link_type) WHERE is_accepted = true;
