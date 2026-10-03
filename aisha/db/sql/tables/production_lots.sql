-- Table: production_lots
-- Material lot genealogy — each received/produced lot is a first-class entity
-- Maps to erp-basis.md: Material Lot (lot_id, supplier_lot, status lifecycle, CoA, FEFO)
-- Replaces the text field raw_material_lot on production_batches with proper FK traceability
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_lots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lot_number text NOT NULL,
  item_id uuid NOT NULL,
  supplier_id uuid,
  supplier_lot text,
  supplier_lot_reference text,
  received_at timestamptz,
  manufactured_at timestamptz,
  expires_at date,
  quantity numeric(16,6),
  remaining_quantity numeric(16,6),
  uom text NOT NULL DEFAULT 'kg',
  status text DEFAULT 'quarantine' NOT NULL,
  coa_document_id uuid,
  storage_location_id uuid,
  storage_conditions text,
  batch_id uuid,
  is_active boolean DEFAULT true NOT NULL,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT production_lots_number_key UNIQUE (lot_number),
  CONSTRAINT production_lots_status_check CHECK (
    status IN ('quarantine', 'sampling', 'released', 'rejected', 'consumed', 'expired', 'recalled')
  ),
  CONSTRAINT production_lots_item_fkey FOREIGN KEY (item_id) REFERENCES production_materials(id) ON DELETE RESTRICT,
  CONSTRAINT production_lots_supplier_fkey FOREIGN KEY (supplier_id) REFERENCES production_suppliers(id) ON DELETE SET NULL,
  CONSTRAINT production_lots_location_fkey FOREIGN KEY (storage_location_id) REFERENCES production_locations(id) ON DELETE SET NULL,
  CONSTRAINT production_lots_batch_fkey FOREIGN KEY (batch_id) REFERENCES production_batches(id) ON DELETE SET NULL,
  CONSTRAINT production_lots_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT production_lots_qty_non_negative CHECK (quantity >= 0 OR quantity IS NULL),
  CONSTRAINT production_lots_remaining_non_negative CHECK (remaining_quantity >= 0 OR remaining_quantity IS NULL)
);

ALTER TABLE production_lots ENABLE ROW LEVEL SECURITY;

-- Grants: admin-managed, read for authenticated
GRANT SELECT ON production_lots TO authenticated;
GRANT ALL ON production_lots TO service_role;

-- Indexes

-- Column documentation
COMMENT ON TABLE production_lots IS 'Material lot genealogy. Each received or produced lot is a first-class entity with status lifecycle (quarantine → released → consumed). Per erp-basis.md: lot traceability, FEFO, CoA.';
COMMENT ON COLUMN production_lots.lot_number IS 'Unique lot identifier, e.g. LOT-HERB-2024-001, LOT-ETOH-2024-003';
COMMENT ON COLUMN production_lots.item_id IS 'Material item (FK to production_materials)';
COMMENT ON COLUMN production_lots.supplier_id IS 'Supplier who provided this lot (FK to production_suppliers)';
COMMENT ON COLUMN production_lots.supplier_lot IS 'Supplier''s own lot/batch number for traceability';
COMMENT ON COLUMN production_lots.status IS 'Lot lifecycle: quarantine → sampling → released → consumed/expired/recalled | rejected';
COMMENT ON COLUMN production_lots.coa_document_id IS 'Certificate of Analysis document reference';
COMMENT ON COLUMN production_lots.batch_id IS 'Production batch that produced this lot (for intermediates/finished goods)';
COMMENT ON COLUMN production_lots.remaining_quantity IS 'Current remaining quantity (decremented by inventory events)';
