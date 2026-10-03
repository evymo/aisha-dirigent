-- Index: idx_health_data_recorded_at
-- Table: health_data

CREATE INDEX idx_health_data_recorded_at ON public.health_data USING btree (user_id, recorded_at DESC);
