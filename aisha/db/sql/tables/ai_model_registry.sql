-- Table: ai_model_registry

CREATE TABLE IF NOT EXISTS public.ai_model_registry (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  provider text NOT NULL,
  model_id text NOT NULL,
  display_name text,
  model_family text,
  is_chat_capable boolean DEFAULT true NOT NULL,
  is_reasoning boolean DEFAULT false NOT NULL,
  is_vision boolean DEFAULT false NOT NULL,
  is_code_optimized boolean DEFAULT false NOT NULL,
  is_function_calling boolean DEFAULT false NOT NULL,
  -- Embedding capability (derived, symmetric with is_chat_capable): an embedding model
  -- is a first-class capability-available entity, NOT an allow-listed name. The resolver
  -- filters task_kind='embedding' by is_embedding. embedding_dimensions is the native
  -- output dim (e.g. 1536 v1 / 2560 v2) for the MRL sweep + the model-as-index-constant
  -- match guard; NULL for non-embedding models.
  is_embedding boolean DEFAULT false NOT NULL,
  embedding_dimensions integer,
  context_window integer,
  max_output_tokens integer,
  input_price_per_m numeric,
  output_price_per_m numeric,
  cached_input_price_per_m numeric,
  first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  is_available boolean DEFAULT true NOT NULL,
  is_admin_active boolean DEFAULT false NOT NULL,
  is_deprecated boolean DEFAULT false NOT NULL,
  deprecation_date timestamp with time zone,
  eval_status text DEFAULT 'pending'::text NOT NULL,
  latest_eval_run_id uuid,
  latest_eval_score numeric,
  latest_eval_at timestamp with time zone,
  provider_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- Soulforge slot×tier routing map: { "<slot>:<tier>": "<model_id>", ... }.
  -- Added by migration 20260515112000_soulforge_slot_routing.sql; mirrored
  -- here so the SoT table file matches runtime schema (required by
  -- sql-function-column-validation.test.ts which validates against SoT).
  slot_affinity jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.ai_model_registry ENABLE ROW LEVEL SECURITY;

-- Columns added by later migrations (back-port reconciliation):
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS provider_registry_id uuid;
