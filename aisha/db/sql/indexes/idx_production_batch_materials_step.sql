-- Index: idx_production_batch_materials_step
CREATE INDEX IF NOT EXISTS idx_production_batch_materials_step ON production_batch_materials (step_id) WHERE step_id IS NOT NULL;
