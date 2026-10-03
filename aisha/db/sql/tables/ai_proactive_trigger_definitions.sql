-- Table: ai_proactive_trigger_definitions

CREATE TABLE IF NOT EXISTS public.ai_proactive_trigger_definitions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  display_name text,
  description text DEFAULT ''::text,
  source_table text NOT NULL,
  source_event text DEFAULT 'INSERT'::text NOT NULL,
  condition jsonb DEFAULT '{}'::jsonb NOT NULL,
  action_type text DEFAULT 'analyze'::text NOT NULL,
  agent_name text,
  workflow_name text,
  action_config jsonb DEFAULT '{}'::jsonb NOT NULL,
  target_roles text[] DEFAULT ARRAY['member'::text],
  priority text DEFAULT 'normal'::text NOT NULL,
  is_active boolean DEFAULT false NOT NULL,
  cooldown_minutes integer DEFAULT 1440 NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  PRIMARY KEY (id),
  -- Pravidlo pro kanál executoru akcí po události (event-worker) MUSÍ mít principála:
  -- outbox ai_proactive_runs je user-scoped (user_id NOT NULL) a dispečer bere
  -- NEW.user_id, jinak created_by. Zdrojové tabulky jako story_entries user_id nemají,
  -- takže pravidlo bez created_by dispečer TIŠE přeskočí (RAISE WARNING) — naměřeno
  -- 2026-09-26 na pravidlech ze seedu. Tady se to odmítne už při zápisu pravidla.
  -- Výčet kanálů = KANALY_EXECUTORU v services/event-worker/src/proaktivni/jadro.ts
  -- (parita hlídá brána proaktivni-executor-kontrakt). Jiné kanály (in_app ze seedu,
  -- AI akce) se netýká: NULL/cizí kanál → podmínka je splněná.
  CONSTRAINT ai_proactive_defs_executor_principal_check CHECK (
    NOT ((action_config ->> 'channel') = ANY (ARRAY['extranet', 'push', 'email']))
    OR created_by IS NOT NULL
  )
);

ALTER TABLE public.ai_proactive_trigger_definitions ENABLE ROW LEVEL SECURITY;
