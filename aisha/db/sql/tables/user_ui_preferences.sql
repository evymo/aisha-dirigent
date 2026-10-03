-- Table: user_ui_preferences
-- Purpose: Non-sensitive data per-user UI preferences (workspace/layout personalization).

CREATE TABLE IF NOT EXISTS public.user_ui_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  sync_enabled boolean NOT NULL DEFAULT false,
  storyloop_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_ui_preferences ENABLE ROW LEVEL SECURITY;
