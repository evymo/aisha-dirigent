-- Table: question_block_types
-- Metadata catalogue of supported question block types.
-- Translations live in the `translations` table (namespace = 'questionnaires').
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS question_block_types (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  type_key text NOT NULL,
  name_key text NOT NULL,
  description_key text,
  icon text,
  component_type text NOT NULL,
  supports_options bool NOT NULL DEFAULT false,
  supports_scale bool NOT NULL DEFAULT false,
  supports_tags bool NOT NULL DEFAULT false,
  supports_multiselect bool NOT NULL DEFAULT false,
  default_config jsonb,
  is_active bool NOT NULL DEFAULT true,
  sort_order int4 NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT question_block_types_type_key_key UNIQUE (type_key)
);

ALTER TABLE question_block_types ENABLE ROW LEVEL SECURITY;
