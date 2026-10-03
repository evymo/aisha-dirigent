-- Table: production_capa
-- Corrective and Preventive Actions linked to deviations
-- Maps to erp-basis.md: CAPA entity (source deviation, actions, effectiveness verification)
-- Required by ICH Q10 Pharmaceutical Quality System (continual improvement)
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_capa (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  capa_number text NOT NULL,
  source_deviation_id uuid,
  capa_type text NOT NULL DEFAULT 'corrective',
  title text NOT NULL,
  description text NOT NULL,
  actions jsonb DEFAULT '[]'::jsonb,
  owner_id uuid,
  due_date date,
  status text DEFAULT 'open' NOT NULL,
  effectiveness_check jsonb,
  effectiveness_verified_at timestamptz,
  effectiveness_verified_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT production_capa_number_key UNIQUE (capa_number),
  CONSTRAINT production_capa_type_check CHECK (
    capa_type IN ('corrective', 'preventive', 'improvement')
  ),
  CONSTRAINT production_capa_status_check CHECK (
    status IN ('open', 'in_progress', 'pending_verification', 'verified', 'closed', 'overdue')
  ),
  CONSTRAINT production_capa_deviation_fkey FOREIGN KEY (source_deviation_id) REFERENCES production_deviations(id) ON DELETE SET NULL,
  CONSTRAINT production_capa_owner_fkey FOREIGN KEY (owner_id) REFERENCES aisha_auth.users(id),
  CONSTRAINT production_capa_verified_by_fkey FOREIGN KEY (effectiveness_verified_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT production_capa_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT production_capa_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_capa ENABLE ROW LEVEL SECURITY;

-- Grants: admin-managed, read for authenticated
GRANT SELECT ON production_capa TO authenticated;
GRANT ALL ON production_capa TO service_role;

-- Column documentation
COMMENT ON TABLE production_capa IS 'Corrective and Preventive Actions. Per erp-basis.md + ICH Q10: linked to deviations, with structured actions, effectiveness verification, and formal closure.';
COMMENT ON COLUMN production_capa.capa_number IS 'Unique sequential identifier, e.g. CAPA-2026-001';
COMMENT ON COLUMN production_capa.capa_type IS 'corrective=fix existing issue, preventive=prevent recurrence, improvement=proactive enhancement';
COMMENT ON COLUMN production_capa.actions IS 'JSONB array of actions: [{action, responsible, due_date, completed_at, status, evidence}]';
COMMENT ON COLUMN production_capa.effectiveness_check IS 'JSONB: {method, criteria, result, evidence_doc_id}';
