-- Table: production_flow_records
-- Immutable regulatory record of substance movement between flow nodes.
-- pure_amount_l is a GENERATED column = volume_l * concentration_pct / 100.
-- Every record belongs to a batch + substance for full traceability.
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_flow_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  substance_id uuid NOT NULL,
  source_node_id uuid NOT NULL,
  target_node_id uuid NOT NULL,
  flow_date timestamptz NOT NULL DEFAULT now(),
  -- Volume & concentration
  volume_l numeric(12,4) NOT NULL,
  concentration_pct numeric(6,3) NOT NULL
    CHECK (concentration_pct >= 0 AND concentration_pct <= 100),
  pure_amount_l numeric(12,4) GENERATED ALWAYS AS (volume_l * concentration_pct / 100.0) STORED,
  -- Temperature at measurement (affects density → real volume)
  temperature_c numeric(5,1),
  -- Traceability
  lot_id uuid,
  responsible_user_id uuid,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  -- Correction/storno fields (added by migration 20260219180000)
  is_storno boolean NOT NULL DEFAULT false,
  is_correction boolean NOT NULL DEFAULT false,
  corrects_record_id uuid,
  correction_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- NO updated_at — immutable regulatory records
  PRIMARY KEY (id),
  CONSTRAINT production_flow_records_batch_id_fkey
    FOREIGN KEY (batch_id) REFERENCES production_batches(id),
  CONSTRAINT production_flow_records_substance_id_fkey
    FOREIGN KEY (substance_id) REFERENCES production_flow_substances(id),
  CONSTRAINT production_flow_records_source_node_id_fkey
    FOREIGN KEY (source_node_id) REFERENCES production_flow_nodes(id),
  CONSTRAINT production_flow_records_target_node_id_fkey
    FOREIGN KEY (target_node_id) REFERENCES production_flow_nodes(id),
  CONSTRAINT production_flow_records_lot_id_fkey
    FOREIGN KEY (lot_id) REFERENCES production_lots(id),
  CONSTRAINT production_flow_records_responsible_user_id_fkey
    FOREIGN KEY (responsible_user_id) REFERENCES aisha_auth.users(id),
  CONSTRAINT production_flow_records_corrects_record_id_fkey
    FOREIGN KEY (corrects_record_id) REFERENCES production_flow_records(id),
  CONSTRAINT production_flow_records_source_ne_target
    CHECK (source_node_id <> target_node_id),
  CONSTRAINT production_flow_records_volume_check
    CHECK (
      (is_storno = true AND volume_l < 0)
      OR (is_storno = false AND volume_l > 0)
    )
);

ALTER TABLE production_flow_records ENABLE ROW LEVEL SECURITY;

-- Performance indexes

-- Grants
GRANT SELECT ON production_flow_records TO authenticated;
GRANT ALL ON production_flow_records TO service_role;

-- Comments
COMMENT ON TABLE production_flow_records IS 'Immutable substance movement records between flow nodes. Core data for balance/loss calculation.';
COMMENT ON COLUMN production_flow_records.volume_l IS 'Volume transferred in litres.';
COMMENT ON COLUMN production_flow_records.concentration_pct IS 'Concentration of tracked substance (0–100%). For ethanol this is ABV.';
COMMENT ON COLUMN production_flow_records.pure_amount_l IS 'Computed pure substance amount = volume_l * concentration_pct / 100. GENERATED STORED.';
COMMENT ON COLUMN production_flow_records.temperature_c IS 'Temperature at time of measurement in °C (affects density-based volume corrections).';
COMMENT ON COLUMN production_flow_records.lot_id IS 'Optional FK to production_lots for raw material lot traceability.';
