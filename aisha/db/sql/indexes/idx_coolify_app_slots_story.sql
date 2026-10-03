-- Index: idx_coolify_app_slots_story
-- Source: aisha/db/migrations/20260428102000_coolify_app_slots_phase2.sql

CREATE INDEX IF NOT EXISTS idx_coolify_app_slots_story
  ON public.coolify_app_slots (story_id) WHERE story_id IS NOT NULL;
