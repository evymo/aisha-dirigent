-- Table: delivery_transitions

CREATE TABLE IF NOT EXISTS public.delivery_transitions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  story_id uuid NOT NULL REFERENCES public.partner_stories ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  triggered_by uuid,
  trigger_source text DEFAULT 'manual'::text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.delivery_transitions ENABLE ROW LEVEL SECURITY;
