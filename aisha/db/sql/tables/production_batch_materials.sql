-- Table: production_batch_materials
-- Actual material consumption and output per batch step with lot-level traceability
-- Maps to erp-basis.md: Batch Material Actual (batch_id + step_id + lot_id + direction)
-- Critical for lot genealogy: every IN/OUT/WASTE must reference a specific lot
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_batch_materials (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  step_id uuid,
  lot_id uuid,
  item_id uuid NOT NULL,
  direction text NOT NULL,
  planned_qty numeric(16,6),
  actual_qty numeric(16,6),
  uom text NOT NULL DEFAULT 'kg',
  variance_pct numeric(10,4) GENERATED ALWAYS AS (
    CASE WHEN planned_qty IS NOT NULL AND planned_qty <> 0
         THEN ROUND(((actual_qty - planned_qty) / planned_qty) * 100, 4)
         ELSE NULL
    END
  ) STORED,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT production_batch_materials_direction_check CHECK (
    direction IN ('IN', 'OUT', 'WASTE', 'SAMPLE', 'BYPRODUCT')
  ),
  CONSTRAINT production_batch_materials_batch_fkey FOREIGN KEY (batch_id) REFERENCES production_batches(id) ON DELETE CASCADE,
  CONSTRAINT production_batch_materials_step_fkey FOREIGN KEY (step_id) REFERENCES production_protocol_steps(id) ON DELETE SET NULL,
  CONSTRAINT production_batch_materials_lot_fkey FOREIGN KEY (lot_id) REFERENCES production_lots(id) ON DELETE RESTRICT,
  CONSTRAINT production_batch_materials_item_fkey FOREIGN KEY (item_id) REFERENCES production_materials(id) ON DELETE RESTRICT,
  CONSTRAINT production_batch_materials_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_batch_materials ENABLE ROW LEVEL SECURITY;

-- Grants: admin-managed, read for authenticated
GRANT SELECT ON production_batch_materials TO authenticated;
GRANT ALL ON production_batch_materials TO service_role;

-- Column documentation
COMMENT ON TABLE production_batch_materials IS 'Actual material consumption/output per batch step. Per erp-basis.md: lot-level traceability for every IN/OUT/WASTE movement. Critical for recall readiness.';
COMMENT ON COLUMN production_batch_materials.direction IS 'Material flow: IN=consumed, OUT=produced, WASTE=discarded, SAMPLE=taken for QC, BYPRODUCT=secondary output';
COMMENT ON COLUMN production_batch_materials.lot_id IS 'Specific lot consumed/produced. Should be NOT NULL for production-grade traceability (enforced at application level).';
COMMENT ON COLUMN production_batch_materials.planned_qty IS 'Expected quantity from BOM/routing';
COMMENT ON COLUMN production_batch_materials.actual_qty IS 'Actually measured quantity';
COMMENT ON COLUMN production_batch_materials.variance_pct IS 'Computed: ((actual_qty - planned_qty) / planned_qty) * 100. NULL when planned_qty is NULL or zero.';
