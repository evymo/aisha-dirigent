-- Index: idx_production_cost_rates_valid
CREATE INDEX IF NOT EXISTS idx_production_cost_rates_valid ON production_cost_rates (valid_from, valid_to);
