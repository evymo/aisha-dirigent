-- Table: leaderboard_entries
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS leaderboard_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL,
  user_id uuid NOT NULL,
  total_points int4 NOT NULL DEFAULT 0,
  completions_count int4 NOT NULL DEFAULT 0,
  streak_days int4 NOT NULL DEFAULT 0,
  rank int4,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT leaderboard_entries_period_id_user_id_key UNIQUE (user_id, period_id),
  CONSTRAINT leaderboard_entries_period_id_fkey FOREIGN KEY (period_id) REFERENCES leaderboard_periods(id) ON DELETE CASCADE,
  CONSTRAINT leaderboard_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE leaderboard_entries ENABLE ROW LEVEL SECURITY;
