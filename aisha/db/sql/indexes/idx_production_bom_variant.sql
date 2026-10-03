-- Index: idx_production_bom_variant
CREATE INDEX IF NOT EXISTS idx_production_bom_variant ON production_bom_entries (variant_code) WHERE variant_code IS NOT NULL;
