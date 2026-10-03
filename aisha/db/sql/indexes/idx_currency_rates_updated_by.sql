-- Index: idx_currency_rates_updated_by
-- Table: currency_rates

CREATE INDEX IF NOT EXISTS idx_currency_rates_updated_by ON public.currency_rates(updated_by);
