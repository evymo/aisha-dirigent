-- Index: idx_production_cost_lines_scenario
CREATE INDEX IF NOT EXISTS idx_production_cost_lines_scenario ON production_cost_lines (scenario_id) WHERE scenario_id IS NOT NULL;
