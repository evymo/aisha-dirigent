-- Table: acs_message_schemas
-- Contract registry (R4) — rows mirror @aisha/acs-contracts schema files.

CREATE TABLE IF NOT EXISTS public.acs_message_schemas (
  schema_ref  text PRIMARY KEY CHECK (schema_ref ~ '^[a-z0-9_.-]+@[0-9]+\.[0-9]+$'),
  json_schema jsonb NOT NULL,
  semantics   text NOT NULL DEFAULT '',              -- human contract: meaning, not just shape
  mode        text NOT NULL DEFAULT 'shadow' CHECK (mode IN ('off','shadow','warn','enforce')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.acs_message_schemas ENABLE ROW LEVEL SECURITY;
