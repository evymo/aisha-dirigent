-- Table: reminder_completions
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS reminder_completions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  reminder_id uuid NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  scheduled_for timestamptz NOT NULL,
  quick_response jsonb,
  questionnaire_response_id uuid,
  health_check_in_id uuid,
  points_awarded int4 NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  client_completed_at timestamptz,
  sync_status text DEFAULT 'synced'::text,
  PRIMARY KEY (id),
  CONSTRAINT reminder_completions_health_check_in_id_fkey FOREIGN KEY (health_check_in_id) REFERENCES health_check_ins(id) ON DELETE SET NULL,
  CONSTRAINT reminder_completions_questionnaire_response_id_fkey FOREIGN KEY (questionnaire_response_id) REFERENCES questionnaire_responses(id) ON DELETE SET NULL,
  CONSTRAINT reminder_completions_reminder_id_fkey FOREIGN KEY (reminder_id) REFERENCES user_reminders(id) ON DELETE CASCADE,
  CONSTRAINT reminder_completions_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE reminder_completions ENABLE ROW LEVEL SECURITY;
