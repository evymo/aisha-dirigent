-- Table: notification_campaign_schedules
-- Defines when campaigns should run (one-time or repeating).

CREATE TABLE IF NOT EXISTS public.notification_campaign_schedules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  run_at timestamptz NOT NULL,
  next_run_at timestamptz NOT NULL,
  repeat_interval_minutes integer,
  status text NOT NULL DEFAULT 'scheduled'::text,
  last_run_at timestamptz,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT notification_campaign_schedules_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.notification_campaigns(id) ON DELETE CASCADE,
  CONSTRAINT notification_campaign_schedules_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  CONSTRAINT notification_campaign_schedules_status_check CHECK (status IN ('scheduled', 'running', 'completed', 'paused', 'failed')),
  CONSTRAINT notification_campaign_schedules_repeat_check CHECK (repeat_interval_minutes IS NULL OR repeat_interval_minutes > 0)
);

ALTER TABLE public.notification_campaign_schedules ENABLE ROW LEVEL SECURITY;
