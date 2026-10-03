-- Index: idx_story_links_target
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_story_links_target ON public.story_links (target_story_id);
