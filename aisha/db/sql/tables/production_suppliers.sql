-- Table: production_suppliers
-- Supplier master data with qualification management
-- Maps to erp-basis.md: Supplier entity (qualification_status, risk assessment, audit trail)
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_suppliers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  supplier_code text NOT NULL,
  supplier_name text NOT NULL,
  country text,
  contacts jsonb DEFAULT '{}'::jsonb,
  qualification_status text DEFAULT 'pending' NOT NULL,
  approved_at timestamptz,
  approved_by uuid,
  risk_level text DEFAULT 'medium' NOT NULL,
  certificates jsonb DEFAULT '[]'::jsonb,
  audit_history jsonb DEFAULT '[]'::jsonb,
  is_active boolean DEFAULT true NOT NULL,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT production_suppliers_code_key UNIQUE (supplier_code),
  CONSTRAINT production_suppliers_qualification_check CHECK (
    qualification_status IN ('pending', 'qualified', 'conditionally_qualified', 'disqualified', 'expired')
  ),
  CONSTRAINT production_suppliers_risk_check CHECK (
    risk_level IN ('low', 'medium', 'high', 'critical')
  ),
  CONSTRAINT production_suppliers_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT production_suppliers_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_suppliers ENABLE ROW LEVEL SECURITY;

-- Grants: admin-managed, read for authenticated
GRANT SELECT ON production_suppliers TO authenticated;
GRANT ALL ON production_suppliers TO service_role;

-- Indexes

-- Column documentation
COMMENT ON TABLE production_suppliers IS 'Supplier master data with qualification management. Per erp-basis.md: qualification_status + risk assessment + audit history.';
COMMENT ON COLUMN production_suppliers.supplier_code IS 'Unique supplier identifier, e.g. SUP-JATKA-01, SUP-ETOH-01';
COMMENT ON COLUMN production_suppliers.qualification_status IS 'Qualification lifecycle: pending → qualified → conditionally_qualified | disqualified | expired';
COMMENT ON COLUMN production_suppliers.risk_level IS 'Supplier risk: low, medium, high, critical. Drives audit frequency per ICH Q9.';
COMMENT ON COLUMN production_suppliers.certificates IS 'JSONB array of certificates: [{type, number, issued_at, expires_at, doc_id}]';
COMMENT ON COLUMN production_suppliers.audit_history IS 'JSONB array of audit records: [{date, result, auditor, findings, next_audit}]';
