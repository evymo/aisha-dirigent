-- Table: collaboration_preferences
-- Per-user (optionally per-story) cross-story collaboration settings.
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS public.collaboration_preferences (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  story_id uuid,

  -- Collaboration autonomy level (5 modes)
  collab_mode text NOT NULL DEFAULT 'notify' CHECK (collab_mode IN ('silent', 'digest', 'notify', 'interactive', 'autopilot')),

  -- Granular filters: what to receive
  notify_status_changes boolean NOT NULL DEFAULT true,
  notify_blockers boolean NOT NULL DEFAULT true,
  notify_architecture_decisions boolean NOT NULL DEFAULT true,
  notify_code_events boolean NOT NULL DEFAULT false,
  notify_participant_changes boolean NOT NULL DEFAULT false,
  notify_ai_suggestions boolean NOT NULL DEFAULT true,

  -- Intensity
  max_daily_cross_notifications integer NOT NULL DEFAULT 10 CHECK (max_daily_cross_notifications >= 0 AND max_daily_cross_notifications <= 100),
  min_severity text NOT NULL DEFAULT 'medium' CHECK (min_severity IN ('low', 'medium', 'high', 'critical')),

  -- Quiet hours
  quiet_start time NOT NULL DEFAULT '22:00:00'::time,
  quiet_end time NOT NULL DEFAULT '07:00:00'::time,
  timezone text NOT NULL DEFAULT 'Europe/Prague',

  -- Autopilot limits (only for collab_mode='autopilot')
  autopilot_max_actions_per_day integer NOT NULL DEFAULT 3 CHECK (autopilot_max_actions_per_day >= 0 AND autopilot_max_actions_per_day <= 20),
  autopilot_allowed_actions text[] NOT NULL DEFAULT '{suggest_link,create_thread,notify_overlap}'::text[],
  autopilot_risk_ceiling text NOT NULL DEFAULT 'low' CHECK (autopilot_risk_ceiling IN ('low', 'medium')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT collab_prefs_user_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  CONSTRAINT collab_prefs_story_fkey FOREIGN KEY (story_id) REFERENCES public.partner_stories(id) ON DELETE CASCADE,
  CONSTRAINT collab_prefs_unique_user_story UNIQUE (user_id, story_id)
);

ALTER TABLE public.collaboration_preferences ENABLE ROW LEVEL SECURITY;
