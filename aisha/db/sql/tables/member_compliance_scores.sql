-- Table: member_compliance_scores
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS member_compliance_scores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  member_token uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  required_checkins int4 DEFAULT 0,
  completed_checkins int4 DEFAULT 0,
  required_lab_tests int4 DEFAULT 0,
  completed_lab_tests int4 DEFAULT 0,
  required_dosing_logs int4 DEFAULT 0,
  completed_dosing_logs int4 DEFAULT 0,
  compliance_score numeric,
  tokens_earned int4 DEFAULT 0,
  tokens_used_for_discount int4 DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT member_compliance_scores_member_token_period_start_key UNIQUE (period_start, member_token),
  CONSTRAINT member_compliance_scores_member_token_fkey FOREIGN KEY (member_token) REFERENCES member_distribution_plans(member_token) ON DELETE CASCADE
);

ALTER TABLE member_compliance_scores ENABLE ROW LEVEL SECURITY;
