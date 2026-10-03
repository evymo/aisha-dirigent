-- Index: idx_forecast_items_month
-- Table: distribution_forecast_items

CREATE INDEX idx_forecast_items_month ON public.distribution_forecast_items USING btree (forecast_month);
