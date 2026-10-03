-- Table: moderation_sessions

CREATE TABLE IF NOT EXISTS public.moderation_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  story_id uuid REFERENCES public.partner_stories ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES aisha_auth.users ON DELETE CASCADE,
  session_type text NOT NULL,
  expertise_level text DEFAULT 'intermediate'::text NOT NULL,
  tech_stack jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'active'::text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.moderation_sessions ENABLE ROW LEVEL SECURITY;

-- Columns added by later migrations (back-port reconciliation):
ALTER TABLE public.moderation_sessions ADD COLUMN IF NOT EXISTS ide_kind text DEFAULT 'unknown'::text;
