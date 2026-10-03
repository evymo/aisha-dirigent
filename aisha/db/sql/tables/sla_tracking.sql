-- Table: sla_tracking

CREATE TABLE IF NOT EXISTS public.sla_tracking (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  story_id uuid NOT NULL,
  matrix_room_id text NOT NULL,
  first_message_at timestamp with time zone,
  first_response_at timestamp with time zone,
  response_time_ms integer GENERATED ALWAYS AS (
CASE
    WHEN ((first_response_at IS NOT NULL) AND (first_message_at IS NOT NULL)) THEN (EXTRACT(epoch FROM (first_response_at - first_message_at)) * (1000)::numeric)
    ELSE NULL::numeric
END) STORED,
  sla_breached boolean DEFAULT false NOT NULL,
  escalated_at timestamp with time zone,
  escalated_to uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT sla_tracking_escalated_to_fkey FOREIGN KEY (escalated_to) REFERENCES aisha_auth.users(id),
  CONSTRAINT sla_tracking_story_id_fkey FOREIGN KEY (story_id) REFERENCES public.partner_stories(id) ON DELETE CASCADE
);

ALTER TABLE public.sla_tracking ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.sla_tracking IS 'Tracks first-response SLA per story Matrix room. Auto-escalation at 30min breach.';
