-- Index: idx_story_links_agent
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_story_links_agent ON public.story_links (created_by_agent) WHERE created_by_agent IS NOT NULL;
