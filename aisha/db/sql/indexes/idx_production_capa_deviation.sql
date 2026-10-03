-- Index: idx_production_capa_deviation
CREATE INDEX IF NOT EXISTS idx_production_capa_deviation ON production_capa (source_deviation_id) WHERE source_deviation_id IS NOT NULL;
