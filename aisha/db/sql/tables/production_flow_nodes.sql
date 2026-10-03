-- Table: production_flow_nodes
-- Universal flow graph nodes for tracking movement of ANY substance
-- (ethanol, solvents, extracts, water, etc.) through production.
-- Links optionally to production_locations and production_suppliers.
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_flow_nodes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  node_code text NOT NULL,
  node_name text NOT NULL,
  node_type text NOT NULL
    CHECK (node_type IN (
      'supplier',       -- Vstupní bod (dodavatel)
      'storage',        -- Sklad / nádrž / daňový sklad
      'process',        -- Výrobní krok (macerace, filtrace, destilace…)
      'regeneration',   -- Zpětné získávání / recyklace
      'finished',       -- Hotový výrobek
      'waste'           -- Odpad / likvidace (oficiální měřená ztráta)
    )),
  -- Volitelné propojení do ERP master dat
  location_id uuid,
  supplier_id uuid,
  equipment_id uuid,
  -- Kapacita a operační parametry
  capacity_l numeric(12,4),
  default_concentration_pct numeric(6,3),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT production_flow_nodes_node_code_key UNIQUE (node_code),
  CONSTRAINT production_flow_nodes_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES production_locations(id),
  CONSTRAINT production_flow_nodes_supplier_id_fkey
    FOREIGN KEY (supplier_id) REFERENCES production_suppliers(id),
  CONSTRAINT production_flow_nodes_equipment_id_fkey
    FOREIGN KEY (equipment_id) REFERENCES production_equipment(id),
  CONSTRAINT production_flow_nodes_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_flow_nodes ENABLE ROW LEVEL SECURITY;

-- Performance indexes

-- Grants
GRANT SELECT ON production_flow_nodes TO authenticated;
GRANT ALL ON production_flow_nodes TO service_role;

-- Comments
COMMENT ON TABLE production_flow_nodes IS 'Universal flow graph nodes — places where any tracked substance resides or passes through in production.';
COMMENT ON COLUMN production_flow_nodes.node_type IS 'supplier=input, storage=holding, process=manufacturing step, regeneration=reclaim, finished=output product, waste=measured loss';
COMMENT ON COLUMN production_flow_nodes.capacity_l IS 'Maximum capacity of this node in litres (for storage/tanks).';
COMMENT ON COLUMN production_flow_nodes.default_concentration_pct IS 'Default concentration (0–100%) used as Smart Input suggestion for new flows from this node.';
COMMENT ON COLUMN production_flow_nodes.location_id IS 'FK to production_locations for physical mapping.';
COMMENT ON COLUMN production_flow_nodes.supplier_id IS 'FK to production_suppliers for supplier-type nodes.';
COMMENT ON COLUMN production_flow_nodes.equipment_id IS 'FK to production_equipment for process-type nodes (reactors, tanks, etc.).';
