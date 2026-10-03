-- Index: idx_production_lots_active
CREATE INDEX IF NOT EXISTS idx_production_lots_active ON production_lots (is_active) WHERE is_active = true;
