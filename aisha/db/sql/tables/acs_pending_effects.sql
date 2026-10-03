-- Table: acs_pending_effects
-- Readback state (R5 / IP-8).

CREATE TABLE IF NOT EXISTS public.acs_pending_effects (
  effect_id     text PRIMARY KEY CHECK (effect_id ~ '^eff_[0-9A-HJKMNP-TV-Z]{26}$'),
  intent_id     text NOT NULL REFERENCES public.acs_intents(intent_id),
  tool_name     text NOT NULL,
  effect_class  text NOT NULL CHECK (effect_class IN ('write','delete','payment','deploy','external_call','unclassified')),
  proposal      jsonb NOT NULL,
  params_sha256 text NOT NULL CHECK (params_sha256 ~ '^[a-f0-9]{64}$'),
  state         text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed','confirmed','executed','aborted','expired')),
  decision      jsonb NULL,
  proposed_at   timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz NULL,
  executed_at   timestamptz NULL,
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '15 minutes'
);

ALTER TABLE public.acs_pending_effects ENABLE ROW LEVEL SECURITY;
