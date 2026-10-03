-- Table: production_materials
-- Master data registry of all items (raw materials, intermediates, finished goods, packaging)
-- Maps to ERP md_item concept from storm-source-of-truth.md §6.2
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_materials (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_code text NOT NULL,
  item_name text NOT NULL,
  item_type text NOT NULL DEFAULT 'RAW',
  uom text NOT NULL DEFAULT 'kg',
  category text,
  description text,
  cas_number text,
  supplier_default text,
  min_stock_qty numeric(12,4),
  reorder_point numeric(12,4),
  shelf_life_days integer,
  storage_conditions text,
  is_active boolean DEFAULT true NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT production_materials_item_code_key UNIQUE (item_code),
  CONSTRAINT production_materials_item_type_check CHECK (
    item_type IN ('RAW', 'INTERMEDIATE', 'FINISHED', 'PACKAGING', 'CONSUMABLE')
  ),
  CONSTRAINT production_materials_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_materials ENABLE ROW LEVEL SECURITY;

-- Grants: admin-managed, read for authenticated
GRANT SELECT ON production_materials TO authenticated;
GRANT ALL ON production_materials TO service_role;

-- Column documentation
COMMENT ON TABLE production_materials IS 'Master data: all production items (raw materials, intermediates, finished goods, packaging). ERP md_item equivalent.';
COMMENT ON COLUMN production_materials.item_code IS 'Unique item identifier, e.g. BLOOD-RAW, HERB-DRY, RET-FINAL';
COMMENT ON COLUMN production_materials.item_type IS 'Item classification: RAW, INTERMEDIATE, FINISHED, PACKAGING, CONSUMABLE';
COMMENT ON COLUMN production_materials.uom IS 'Default unit of measure: kg, L, ml, g, ks (pieces)';
COMMENT ON COLUMN production_materials.category IS 'Product category: Retisin, Floristen, Lyastin, Společné';
COMMENT ON COLUMN production_materials.cas_number IS 'CAS registry number for chemical identification';
COMMENT ON COLUMN production_materials.shelf_life_days IS 'Shelf life in days from production date';
COMMENT ON COLUMN production_materials.storage_conditions IS 'Required storage conditions (temperature, humidity, light)';
