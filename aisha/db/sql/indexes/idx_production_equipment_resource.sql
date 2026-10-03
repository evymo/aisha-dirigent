-- Index: idx_production_equipment_resource
CREATE INDEX IF NOT EXISTS idx_production_equipment_resource ON production_equipment (resource_id) WHERE resource_id IS NOT NULL;
