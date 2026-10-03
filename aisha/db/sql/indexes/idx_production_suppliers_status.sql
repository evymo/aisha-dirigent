-- Index: idx_production_suppliers_status
CREATE INDEX IF NOT EXISTS idx_production_suppliers_status ON production_suppliers (qualification_status);
