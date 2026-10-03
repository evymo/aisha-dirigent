-- Table: leaderboard_periods
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS leaderboard_periods (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  period_type text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT leaderboard_periods_period_type_period_start_period_end_key UNIQUE (period_end, period_start, period_type)
);

ALTER TABLE leaderboard_periods ENABLE ROW LEVEL SECURITY;
