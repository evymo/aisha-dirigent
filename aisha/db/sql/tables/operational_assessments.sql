-- Table: operational_assessments
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS operational_assessments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status assessment_status NOT NULL DEFAULT 'in_progress'::assessment_status,
  assessment_type text NOT NULL DEFAULT 'onboarding'::text,
  overall_score numeric(5,2),
  interpretation text,
  baseline_assessment_id uuid,
  trend_vs_baseline numeric(5,2),
  alert_flags text[] DEFAULT '{}'::text[],
  has_critical_flags bool DEFAULT false,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  dimensions jsonb DEFAULT '[]'::jsonb,
  PRIMARY KEY (id),
  CONSTRAINT operational_assessments_baseline_assessment_id_fkey FOREIGN KEY (baseline_assessment_id) REFERENCES operational_assessments(id),
  CONSTRAINT operational_assessments_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE operational_assessments ENABLE ROW LEVEL SECURITY;
