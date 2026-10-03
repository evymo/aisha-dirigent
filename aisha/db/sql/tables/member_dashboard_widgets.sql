-- Table: member_dashboard_widgets
-- Dashboard widget configuration
-- RLS: ENABLED
-- Created: 2026-01-17

CREATE TABLE IF NOT EXISTS public.member_dashboard_widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  widget_type text NOT NULL CHECK (widget_type IN ('product', 'health_state', 'quick_log', 'calendar', 'distribution')),
  reference_id uuid, -- ID of product_plan or health_state
  position jsonb NOT NULL DEFAULT '{"row": 0, "col": 0, "width": 1, "height": 1}'::jsonb,
  settings jsonb DEFAULT '{}'::jsonb,
  is_visible boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, widget_type, reference_id)
);

ALTER TABLE public.member_dashboard_widgets ENABLE ROW LEVEL SECURITY;

-- Column documentation
COMMENT ON TABLE public.member_dashboard_widgets IS 'Dashboard widget configuration for member diary';
COMMENT ON COLUMN public.member_dashboard_widgets.user_id IS 'Owner of this widget';
COMMENT ON COLUMN public.member_dashboard_widgets.widget_type IS 'Type: product, health_state, quick_log, calendar, distribution';
COMMENT ON COLUMN public.member_dashboard_widgets.reference_id IS 'Reference to product_plan or health_state if applicable';
COMMENT ON COLUMN public.member_dashboard_widgets.position IS 'Grid position: row, col, width, height';
COMMENT ON COLUMN public.member_dashboard_widgets.settings IS 'Widget-specific settings';
COMMENT ON COLUMN public.member_dashboard_widgets.is_visible IS 'Whether widget is currently visible';
