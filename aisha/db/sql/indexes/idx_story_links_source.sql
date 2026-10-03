-- Index: idx_story_links_source
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_story_links_source ON public.story_links (source_story_id);
