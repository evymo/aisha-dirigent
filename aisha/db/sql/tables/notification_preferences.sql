-- Table: notification_preferences
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS notification_preferences (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  push_enabled bool NOT NULL DEFAULT true,
  push_reminders bool NOT NULL DEFAULT true,
  push_health_insights bool NOT NULL DEFAULT true,
  push_leaderboard bool NOT NULL DEFAULT false,
  push_study_updates bool NOT NULL DEFAULT true,
  push_achievements bool NOT NULL DEFAULT true,
  quiet_hours_enabled bool NOT NULL DEFAULT false,
  quiet_hours_start time DEFAULT '22:00:00'::time without time zone,
  quiet_hours_end time DEFAULT '07:00:00'::time without time zone,
  morning_start time DEFAULT '09:00:00'::time without time zone,
  afternoon_start time DEFAULT '14:00:00'::time without time zone,
  evening_start time DEFAULT '20:00:00'::time without time zone,
  questionnaire_reminder_period text DEFAULT 'morning'::text,
  user_timezone text DEFAULT 'Europe/Prague'::text,
  email_weekly_summary bool NOT NULL DEFAULT true,
  email_monthly_report bool NOT NULL DEFAULT true,
  email_study_invitations bool NOT NULL DEFAULT true,
  max_daily_push_notifications int4 NOT NULL DEFAULT 10,
  min_notification_interval_minutes int4 NOT NULL DEFAULT 30,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT notification_preferences_user_id_key UNIQUE (user_id),
  CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
