-- Index: idx_production_capa_owner
CREATE INDEX IF NOT EXISTS idx_production_capa_owner ON production_capa (owner_id) WHERE owner_id IS NOT NULL;
