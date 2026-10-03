-- Index: idx_production_capa_due_date
CREATE INDEX IF NOT EXISTS idx_production_capa_due_date ON production_capa (due_date) WHERE due_date IS NOT NULL;
