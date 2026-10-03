-- Table: notification_campaign_runs
-- Execution log for campaign schedule runs.

CREATE TABLE IF NOT EXISTS public.notification_campaign_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  schedule_id uuid,
  run_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'sent'::text,
  recipients_count integer NOT NULL DEFAULT 0,
  push_sent integer NOT NULL DEFAULT 0,
  inapp_sent integer NOT NULL DEFAULT 0,
  errors jsonb,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT notification_campaign_runs_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.notification_campaigns(id) ON DELETE CASCADE,
  CONSTRAINT notification_campaign_runs_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.notification_campaign_schedules(id) ON DELETE SET NULL
);

ALTER TABLE public.notification_campaign_runs ENABLE ROW LEVEL SECURITY;
