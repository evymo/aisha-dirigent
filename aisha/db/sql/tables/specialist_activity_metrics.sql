-- Table: specialist_activity_metrics
-- Aggregated specialist performance metrics for marketplace ranking.
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS specialist_activity_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL,
  completed_projects_30d integer NOT NULL DEFAULT 0,
  completed_projects_total integer NOT NULL DEFAULT 0,
  avg_rating_30d numeric(3,2) DEFAULT 0,
  avg_rating_total numeric(3,2) DEFAULT 0,
  response_time_avg_hours numeric(5,1),
  acceptance_rate numeric(5,2) DEFAULT 100,
  cancellation_rate numeric(5,2) DEFAULT 0,
  rules_contributed_count integer NOT NULL DEFAULT 0,
  rules_updated_30d integer NOT NULL DEFAULT 0,
  last_project_completed_at timestamptz,
  activity_score numeric(6,2) NOT NULL DEFAULT 0,
  last_calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT specialist_activity_metrics_partner_id_key UNIQUE (partner_id),
  CONSTRAINT specialist_activity_metrics_partner_id_fkey FOREIGN KEY (partner_id)
    REFERENCES partner_profiles(id) ON DELETE CASCADE
);

ALTER TABLE specialist_activity_metrics ENABLE ROW LEVEL SECURITY;

