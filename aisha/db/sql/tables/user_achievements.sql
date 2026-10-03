-- Table: user_achievements
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS user_achievements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  achievement_id uuid NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  notified bool NOT NULL DEFAULT false,
  PRIMARY KEY (id),
  CONSTRAINT user_achievements_user_id_achievement_id_key UNIQUE (achievement_id, user_id),
  CONSTRAINT user_achievements_achievement_id_fkey FOREIGN KEY (achievement_id) REFERENCES achievements(id) ON DELETE CASCADE,
  CONSTRAINT user_achievements_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
