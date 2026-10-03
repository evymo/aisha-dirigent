-- Index: idx_token_production_events_study_id
-- Table: token_production_events

CREATE INDEX IF NOT EXISTS idx_token_production_events_study_id ON public.token_production_events(study_id);
