-- Table: acs_message_log
-- Append-only message log (R6) — UNIQUE message_id is the replay/dedup gate.

CREATE TABLE IF NOT EXISTS public.acs_message_log (
  message_id     text PRIMARY KEY CHECK (message_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  schema_ref     text NOT NULL REFERENCES public.acs_message_schemas(schema_ref),
  intent_id      text NOT NULL REFERENCES public.acs_intents(intent_id),
  correlation_id text NOT NULL CHECK (correlation_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  causation_id   text NULL CHECK (causation_id IS NULL OR causation_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  sender         text NOT NULL,
  recipient      text NOT NULL,
  sent_at        timestamptz NOT NULL,
  signature      text NULL,
  trust          jsonb NOT NULL,
  payload        jsonb NOT NULL,
  logged_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.acs_message_log ENABLE ROW LEVEL SECURITY;
