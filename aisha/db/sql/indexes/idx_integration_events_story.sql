-- Index: idx_integration_events_story
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_integration_events_story
  ON public.integration_events (story_id, created_at) WHERE story_id IS NOT NULL;
