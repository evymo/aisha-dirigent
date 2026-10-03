-- Table: acs_intents
-- Canonical intents (R3) — immutable once written.

CREATE TABLE IF NOT EXISTS public.acs_intents (
  intent_id     text PRIMARY KEY CHECK (intent_id ~ '^int_[0-9A-HJKMNP-TV-Z]{26}$'),
  canonical     jsonb NOT NULL,                      -- frozen original request (verbatim)
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  source_class  text NOT NULL CHECK (source_class IN ('internal','partner','byod','public')),
  created_by    text NOT NULL,                       -- service.component identity
  created_at    timestamptz NOT NULL DEFAULT now(),
  ai_run_id     uuid NULL                            -- optional anchor to ai_runs
);

ALTER TABLE public.acs_intents ENABLE ROW LEVEL SECURITY;
