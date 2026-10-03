-- Index: idx_forecast_items_study
-- Table: distribution_forecast_items

CREATE INDEX idx_forecast_items_study ON public.distribution_forecast_items USING btree (study_id);
