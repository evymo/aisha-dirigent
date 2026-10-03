-- Index: idx_production_token_events_participant_id
-- Table: production_token_events

CREATE INDEX IF NOT EXISTS idx_production_token_events_participant_id ON public.production_token_events(participant_id);
