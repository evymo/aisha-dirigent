-- Table: acs_agent_acl
-- Least-privilege routing matrix (R6) — default deny: no row, no traffic.

CREATE TABLE IF NOT EXISTS public.acs_agent_acl (
  sender_pattern    text NOT NULL,   -- exact identity or prefix ending with '.'
  schema_ref        text NOT NULL REFERENCES public.acs_message_schemas(schema_ref),
  recipient_pattern text NOT NULL,
  allowed           boolean NOT NULL DEFAULT true,
  note              text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sender_pattern, schema_ref, recipient_pattern)
);

ALTER TABLE public.acs_agent_acl ENABLE ROW LEVEL SECURITY;
