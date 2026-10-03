-- Index: idx_collab_prefs_story
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_collab_prefs_story ON public.collaboration_preferences (story_id) WHERE story_id IS NOT NULL;
