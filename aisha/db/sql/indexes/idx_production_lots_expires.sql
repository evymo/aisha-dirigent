-- Index: idx_production_lots_expires
CREATE INDEX IF NOT EXISTS idx_production_lots_expires ON production_lots (expires_at) WHERE expires_at IS NOT NULL;
