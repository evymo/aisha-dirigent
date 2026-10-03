-- Table: story_reminders
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS story_reminders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL,
  partner_id uuid NOT NULL,
  remind_at timestamptz NOT NULL,
  message text,
  is_completed bool NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT story_reminders_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES partner_profiles(id) ON DELETE CASCADE,
  CONSTRAINT story_reminders_story_id_fkey FOREIGN KEY (story_id) REFERENCES partner_stories(id) ON DELETE CASCADE
);

ALTER TABLE story_reminders ENABLE ROW LEVEL SECURITY;
