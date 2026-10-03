-- Table: distribution_adjustments
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS distribution_adjustments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  member_token uuid NOT NULL,
  protocol_id uuid,
  adjustment_type text NOT NULL,
  new_dose_amount numeric,
  new_doses_per_day int4,
  new_dose_timing text[],
  new_arm_code text,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_until date,
  reason text NOT NULL,
  authorized_by uuid,
  consultant_note text,
  is_active bool NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT distribution_adjustments_authorized_by_fkey FOREIGN KEY (authorized_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT distribution_adjustments_protocol_id_fkey FOREIGN KEY (protocol_id) REFERENCES study_distribution_protocols(id) ON DELETE CASCADE
);

ALTER TABLE distribution_adjustments ENABLE ROW LEVEL SECURITY;
