-- Table: member_health_states
-- User-defined health states for tracking
-- RLS: ENABLED
-- Created: 2026-01-17

CREATE TABLE IF NOT EXISTS public.member_health_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  name_key text NOT NULL, -- 'asthma', 'rash', 'cough', or custom
  catalog_id uuid REFERENCES public.symptom_catalog(id),
  custom_name text,
  severity_scale int DEFAULT 5 CHECK (severity_scale IN (5, 10)),
  icon text DEFAULT '❓',
  color text DEFAULT '#6366f1',
  is_active boolean DEFAULT true,
  show_on_dashboard boolean DEFAULT true,
  dashboard_position jsonb DEFAULT '{"row": 0, "col": 0}'::jsonb,
  current_severity int, -- Latest logged severity (updated by log_health_state_audited)
  last_logged_at timestamptz, -- Last time this state was logged (updated by log_health_state_audited)
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.member_health_states ENABLE ROW LEVEL SECURITY;

-- Column documentation
COMMENT ON TABLE public.member_health_states IS 'User-defined health states for daily tracking (asthma, rash, pain, etc.)';
COMMENT ON COLUMN public.member_health_states.user_id IS 'Owner of this health state definition';
COMMENT ON COLUMN public.member_health_states.name_key IS 'Predefined key or custom identifier';
COMMENT ON COLUMN public.member_health_states.custom_name IS 'Custom display name if name_key is custom';
COMMENT ON COLUMN public.member_health_states.severity_scale IS 'Scale for severity: 5 or 10 point scale';
COMMENT ON COLUMN public.member_health_states.icon IS 'Emoji or icon identifier for display';
COMMENT ON COLUMN public.member_health_states.color IS 'Color code for display';
COMMENT ON COLUMN public.member_health_states.is_active IS 'Whether currently tracking this state';
COMMENT ON COLUMN public.member_health_states.show_on_dashboard IS 'Show on member dashboard';
COMMENT ON COLUMN public.member_health_states.dashboard_position IS 'Position on dashboard grid';
COMMENT ON COLUMN public.member_health_states.current_severity IS 'Latest logged severity (updated by log_health_state_audited)';
COMMENT ON COLUMN public.member_health_states.last_logged_at IS 'Last time this state was logged (updated by log_health_state_audited)';
