-- Table: production_release_decisions
-- Formal QA release decisions per batch (separate from batch-level qc_approved fields)
-- Maps to erp-basis.md: Release Decision entity (e-sign, QP/QA decision, audit trail)
-- Required by EU GMP Chapter 1 (QP certification) and 21 CFR 211.188 (batch disposition)
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_release_decisions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  decision text NOT NULL,
  decision_at timestamptz DEFAULT now() NOT NULL,
  decided_by uuid NOT NULL,
  reason text,
  linked_deviation_id uuid,
  conditions text,
  review_checklist jsonb,
  review_notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT production_release_decisions_decision_check CHECK (
    decision IN ('released', 'rejected', 'quarantine', 'conditional_release', 'rework', 'retest')
  ),
  CONSTRAINT production_release_decisions_batch_fkey FOREIGN KEY (batch_id) REFERENCES production_batches(id) ON DELETE CASCADE,
  CONSTRAINT production_release_decisions_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT production_release_decisions_deviation_fkey FOREIGN KEY (linked_deviation_id) REFERENCES production_deviations(id) ON DELETE SET NULL
);

ALTER TABLE production_release_decisions ENABLE ROW LEVEL SECURITY;

-- Grants: admin-managed, read for authenticated
GRANT SELECT ON production_release_decisions TO authenticated;
GRANT ALL ON production_release_decisions TO service_role;

-- Indexes

-- Column documentation
COMMENT ON TABLE production_release_decisions IS 'Formal QA release decisions. Per erp-basis.md: each decision is an immutable record with e-signature equivalent (decided_by + decision_at). Multiple decisions per batch allowed (re-evaluation).';
COMMENT ON COLUMN production_release_decisions.decision IS 'Release disposition: released, rejected, quarantine, conditional_release, rework, retest';
COMMENT ON COLUMN production_release_decisions.decided_by IS 'QP/QA user who made the release decision (e-signature equivalent)';
COMMENT ON COLUMN production_release_decisions.conditions IS 'Conditions for conditional_release (e.g. "pending stability data")';
COMMENT ON COLUMN production_release_decisions.review_checklist IS 'JSONB: structured checklist of review items [{item, result, comment}]';
