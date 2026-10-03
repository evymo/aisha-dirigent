-- Table: acs_dead_letters
-- Dead letters (R4) — rejected traffic is preserved, never guessed at.

CREATE TABLE IF NOT EXISTS public.acs_dead_letters (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rejection_code text NOT NULL CHECK (rejection_code IN (
    'envelope_invalid','payload_invalid','unknown_schema','signature_missing',
    'signature_invalid','sender_unknown','duplicate_message','acl_denied')),
  detail         text NOT NULL DEFAULT '',
  raw            jsonb NOT NULL,
  received_by    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.acs_dead_letters ENABLE ROW LEVEL SECURITY;
