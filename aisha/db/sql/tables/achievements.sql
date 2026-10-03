-- Table: achievements
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS achievements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  title text NOT NULL,
  description text,
  icon text,
  category text NOT NULL,
  points_reward int4 NOT NULL DEFAULT 0,
  requirement_type text NOT NULL,
  requirement_value int4 NOT NULL,
  is_active bool NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  title_key text,
  description_key text,
  PRIMARY KEY (id),
  CONSTRAINT achievements_code_key UNIQUE (code)
);

ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
