-- Table: signal_tag_rules

CREATE TABLE IF NOT EXISTS public.signal_tag_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  event_type_pattern text NOT NULL,
  source_pattern text,
  tags text[] DEFAULT '{}'::text[] NOT NULL,
  priority integer DEFAULT 100 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  description text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.signal_tag_rules ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.signal_tag_rules IS 'Declarative auto-tagging rules. When an integration_events row arrives,
   process_signal_audited() RPC scans active rules ordered by priority and
   applies matching tags. Marketers manage these via Appsmith CRUD; no
   custom React UI needed.';
