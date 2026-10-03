-- Index: idx_aitg_reflections_recent
-- Extracted from tables/aitg_aisha_reflections.sql (SQL source separation policy)

CREATE INDEX IF NOT EXISTS idx_aitg_reflections_recent
  ON public.aitg_aisha_reflections(generated_by, reflection_date DESC);
