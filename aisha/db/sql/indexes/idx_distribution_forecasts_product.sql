-- Index: idx_distribution_forecasts_product
-- Table: distribution_forecasts

CREATE INDEX idx_distribution_forecasts_product ON public.distribution_forecasts USING btree (product_id);
