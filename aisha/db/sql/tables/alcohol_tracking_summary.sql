-- Table: alcohol_tracking_summary
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS alcohol_tracking_summary (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  period_start date NOT NULL,
  period_end date NOT NULL,
  total_drinks int4 DEFAULT 0,
  average_per_day numeric(5,2),
  max_per_day int4,
  sober_days int4,
  notes text,
  created_at timestamptz DEFAULT now(),
  opening_volume numeric,
  opening_pure_alcohol numeric,
  received_volume numeric,
  received_pure_alcohol numeric,
  used_in_production numeric,
  used_pure_alcohol numeric,
  regenerated_volume numeric,
  regenerated_pure_alcohol numeric,
  documented_losses numeric,
  documented_losses_pure numeric,
  closing_volume numeric,
  closing_pure_alcohol numeric,
  balance_verified bool,
  verified_by uuid,
  verified_at timestamptz,
  discrepancy_notes text,
  tax_report_submitted bool,
  tax_report_reference text,
  updated_at timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT alcohol_tracking_summary_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE alcohol_tracking_summary ENABLE ROW LEVEL SECURITY;
