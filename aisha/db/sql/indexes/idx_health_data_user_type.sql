-- Index: idx_health_data_user_type
-- Table: health_data

CREATE INDEX idx_health_data_user_type ON public.health_data USING btree (user_id, data_type);
