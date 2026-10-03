-- Table: production_deviations
-- Deviation and investigation tracking for GMP compliance
-- Maps to erp-basis.md: Deviation / Investigation entity
-- Required by 21 CFR 211.188 (batch record deviation documentation)
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_deviations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deviation_number text NOT NULL,
  batch_id uuid,
  step_id uuid,
  equipment_id uuid,
  lot_id uuid,
  severity text NOT NULL DEFAULT 'minor',
  category text,
  title text NOT NULL,
  description text NOT NULL,
  root_cause text,
  immediate_action text,
  disposition text,
  status text DEFAULT 'open' NOT NULL,
  initiated_at timestamptz DEFAULT now() NOT NULL,
  initiated_by uuid,
  investigated_by uuid,
  investigated_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT production_deviations_number_key UNIQUE (deviation_number),
  CONSTRAINT production_deviations_severity_check CHECK (
    severity IN ('minor', 'major', 'critical')
  ),
  CONSTRAINT production_deviations_status_check CHECK (
    status IN ('open', 'investigating', 'root_cause_identified', 'resolved', 'closed', 'escalated')
  ),
  CONSTRAINT production_deviations_category_check CHECK (
    category IS NULL OR category IN (
      'process', 'equipment', 'material', 'environmental', 'documentation',
      'contamination', 'yield', 'quality', 'safety', 'other'
    )
  ),
  CONSTRAINT production_deviations_batch_fkey FOREIGN KEY (batch_id) REFERENCES production_batches(id) ON DELETE SET NULL,
  CONSTRAINT production_deviations_step_fkey FOREIGN KEY (step_id) REFERENCES production_protocol_steps(id) ON DELETE SET NULL,
  CONSTRAINT production_deviations_equipment_fkey FOREIGN KEY (equipment_id) REFERENCES production_equipment(id) ON DELETE SET NULL,
  CONSTRAINT production_deviations_lot_fkey FOREIGN KEY (lot_id) REFERENCES production_lots(id) ON DELETE SET NULL,
  CONSTRAINT production_deviations_initiated_by_fkey FOREIGN KEY (initiated_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT production_deviations_investigated_by_fkey FOREIGN KEY (investigated_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT production_deviations_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT production_deviations_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_deviations ENABLE ROW LEVEL SECURITY;

-- Grants: admin-managed, read for authenticated
GRANT SELECT ON production_deviations TO authenticated;
GRANT ALL ON production_deviations TO service_role;

-- Indexes

-- Column documentation
COMMENT ON TABLE production_deviations IS 'Deviation and investigation tracking. Per erp-basis.md + 21 CFR 211.188: every deviation from expected process must be documented with root cause, disposition, and approval.';
COMMENT ON COLUMN production_deviations.deviation_number IS 'Unique sequential identifier, e.g. DEV-2026-001';
COMMENT ON COLUMN production_deviations.severity IS 'Impact classification: minor (no product impact), major (potential impact), critical (confirmed impact)';
COMMENT ON COLUMN production_deviations.category IS 'Deviation category for trending and analysis';
COMMENT ON COLUMN production_deviations.disposition IS 'Final decision: use_as_is, rework, reject, retest';
COMMENT ON COLUMN production_deviations.root_cause IS 'Root cause analysis result (documented after investigation)';
