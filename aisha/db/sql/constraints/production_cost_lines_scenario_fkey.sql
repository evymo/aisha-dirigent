-- Constraint: production_cost_lines_scenario_fkey
-- Deferred FK: production_cost_lines.scenario_id → production_cost_scenarios.id
-- Must be applied AFTER production_cost_scenarios table exists
-- (alphabetical ordering: cost_lines < cost_scenarios → inline FK would fail)

ALTER TABLE production_cost_lines
  ADD CONSTRAINT production_cost_lines_scenario_fkey
  FOREIGN KEY (scenario_id)
  REFERENCES production_cost_scenarios(id)
  ON DELETE SET NULL;
