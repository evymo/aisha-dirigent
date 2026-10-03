-- Table: user_reminders
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS user_reminders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  reminder_type text NOT NULL,
  questionnaire_id uuid,
  product_id uuid,
  study_registration_id uuid,
  frequency text NOT NULL,
  custom_frequency_days int4[],
  time_of_day time NOT NULL,
  scheduled_time time,
  days_of_week int4[],
  notification_enabled bool DEFAULT true,
  metadata jsonb,
  quick_question text,
  quick_response_type text,
  points_per_completion int4 NOT NULL DEFAULT 10,
  is_active bool NOT NULL DEFAULT true,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_timezone text DEFAULT 'Europe/Prague'::text,
  PRIMARY KEY (id),
  CONSTRAINT user_reminders_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  CONSTRAINT user_reminders_questionnaire_id_fkey FOREIGN KEY (questionnaire_id) REFERENCES questionnaires(id) ON DELETE SET NULL,
  CONSTRAINT user_reminders_study_registration_id_fkey FOREIGN KEY (study_registration_id) REFERENCES study_registrations(id) ON DELETE SET NULL,
  CONSTRAINT user_reminders_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE user_reminders ENABLE ROW LEVEL SECURITY;
