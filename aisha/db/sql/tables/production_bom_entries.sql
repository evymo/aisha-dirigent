-- Table: production_bom_entries
-- Bill of Materials: defines parent→child material relationships per production step
-- Maps to ERP std_bom concept from storm-source-of-truth.md §6.3
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_bom_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  parent_item_id uuid NOT NULL,
  child_item_id uuid NOT NULL,
  qty_per numeric(12,6) NOT NULL,
  uom text NOT NULL DEFAULT 'kg',
  step_code text,
  variant_code text,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true NOT NULL,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT production_bom_entries_parent_fkey FOREIGN KEY (parent_item_id) REFERENCES production_materials(id) ON DELETE CASCADE,
  CONSTRAINT production_bom_entries_child_fkey FOREIGN KEY (child_item_id) REFERENCES production_materials(id) ON DELETE CASCADE,
  CONSTRAINT production_bom_entries_qty_positive CHECK (qty_per > 0),
  CONSTRAINT production_bom_entries_no_self_ref CHECK (parent_item_id <> child_item_id),
  CONSTRAINT production_bom_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_bom_entries ENABLE ROW LEVEL SECURITY;

-- Grants: admin-managed, read for authenticated
GRANT SELECT ON production_bom_entries TO authenticated;
GRANT ALL ON production_bom_entries TO service_role;

-- Column documentation
COMMENT ON TABLE production_bom_entries IS 'Bill of Materials: parent→child material relationships. Defines how much of child is needed to produce one unit of parent. ERP std_bom equivalent.';
COMMENT ON COLUMN production_bom_entries.parent_item_id IS 'Product/intermediate being produced';
COMMENT ON COLUMN production_bom_entries.child_item_id IS 'Input material consumed';
COMMENT ON COLUMN production_bom_entries.qty_per IS 'Quantity of child per unit of parent (e.g. 3.543 kg fresh herb per kg dry herb)';
COMMENT ON COLUMN production_bom_entries.uom IS 'Unit of measure for qty_per ratio, e.g. kg/kg, L/L, ks/ks';
COMMENT ON COLUMN production_bom_entries.step_code IS 'Production step where consumption occurs: DRYING, MACERATION, EXTRACTION, CONCENTRATION, FILLING';
COMMENT ON COLUMN production_bom_entries.variant_code IS 'Production variant: SPO, SPO+, SPO++, EKO, EKO+, EKO++, BED, FL-T48, FL-SUSH';
