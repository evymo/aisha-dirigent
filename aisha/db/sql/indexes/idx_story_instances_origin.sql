-- Index: idx_story_instances_origin
-- Ensures only one origin instance per story

CREATE UNIQUE INDEX IF NOT EXISTS idx_story_instances_origin
  ON public.story_instances (story_id)
  WHERE is_origin = true;
