-- Table: production_inventory_events
-- Immutable event-sourced inventory ledger
-- Maps to erp-basis.md: Inventory Ledger Event (RECEIPT/ISSUE/PRODUCE/ADJUST/SCRAP/TRANSFER)
-- Every stock movement is an immutable event; current stock = SUM(events) per lot
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_inventory_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL,
  location_id uuid,
  event_type text NOT NULL,
  quantity numeric(16,6) NOT NULL,
  uom text NOT NULL DEFAULT 'kg',
  ref_type text,
  ref_id uuid,
  reason text,
  performed_by uuid,
  performed_at timestamptz DEFAULT now() NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT production_inventory_events_type_check CHECK (
    event_type IN ('RECEIPT', 'ISSUE', 'PRODUCE', 'ADJUST', 'SCRAP', 'TRANSFER', 'RETURN', 'SAMPLE')
  ),
  CONSTRAINT production_inventory_events_ref_check CHECK (
    ref_type IS NULL OR ref_type IN ('batch', 'shipment', 'adjustment', 'deviation', 'sample', 'transfer')
  ),
  CONSTRAINT production_inventory_events_lot_fkey FOREIGN KEY (lot_id) REFERENCES production_lots(id) ON DELETE RESTRICT,
  CONSTRAINT production_inventory_events_location_fkey FOREIGN KEY (location_id) REFERENCES production_locations(id) ON DELETE SET NULL,
  CONSTRAINT production_inventory_events_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_inventory_events ENABLE ROW LEVEL SECURITY;

-- Grants: admin-managed, read for authenticated
GRANT SELECT ON production_inventory_events TO authenticated;
GRANT ALL ON production_inventory_events TO service_role;

-- Indexes

-- Column documentation
COMMENT ON TABLE production_inventory_events IS 'Immutable event-sourced inventory ledger. Per erp-basis.md: every stock movement is an immutable event. Current stock = SUM(quantity) GROUP BY lot_id.';
COMMENT ON COLUMN production_inventory_events.event_type IS 'RECEIPT=incoming, ISSUE=consumed in batch, PRODUCE=output from batch, ADJUST=inventory correction, SCRAP=disposed, TRANSFER=moved, RETURN=returned, SAMPLE=taken for QC';
COMMENT ON COLUMN production_inventory_events.quantity IS 'Signed quantity: positive for additions (RECEIPT/PRODUCE/RETURN), negative for deductions (ISSUE/SCRAP/SAMPLE)';
COMMENT ON COLUMN production_inventory_events.ref_type IS 'Reference entity type for cross-linking';
COMMENT ON COLUMN production_inventory_events.ref_id IS 'Reference entity ID (batch_id, shipment_id, etc.)';
