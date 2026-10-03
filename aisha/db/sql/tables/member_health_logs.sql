-- Table: member_health_logs
-- Daily health state tracking entries
-- RLS: ENABLED
-- Created: 2026-01-17

CREATE TABLE IF NOT EXISTS public.member_health_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  state_id uuid NOT NULL REFERENCES public.member_health_states(id) ON DELETE CASCADE,
  logged_at timestamptz DEFAULT now(),
  severity int CHECK (severity >= 1 AND severity <= 10),
  started_at timestamptz,
  ended_at timestamptz,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.member_health_logs ENABLE ROW LEVEL SECURITY;

-- Column documentation
COMMENT ON TABLE public.member_health_logs IS 'Daily health state tracking entries';
COMMENT ON COLUMN public.member_health_logs.user_id IS 'User who logged this entry';
COMMENT ON COLUMN public.member_health_logs.state_id IS 'Reference to the health state being tracked';
COMMENT ON COLUMN public.member_health_logs.logged_at IS 'When this entry was logged';
COMMENT ON COLUMN public.member_health_logs.severity IS 'Severity level (1-10)';
COMMENT ON COLUMN public.member_health_logs.started_at IS 'When the symptom started (optional)';
COMMENT ON COLUMN public.member_health_logs.ended_at IS 'When the symptom ended (null if ongoing)';
COMMENT ON COLUMN public.member_health_logs.notes IS 'Additional notes';
COMMENT ON COLUMN public.member_health_logs.metadata IS 'Additional metadata as JSON';
