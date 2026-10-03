-- Index: idx_production_flow_records_lot_id
CREATE INDEX IF NOT EXISTS idx_production_flow_records_lot_id
  ON production_flow_records(lot_id);
