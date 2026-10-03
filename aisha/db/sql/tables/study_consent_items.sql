-- Table: study_consent_items
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS study_consent_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  study_id uuid,
  consent_key text NOT NULL,
  title_key text,
  description_key text,
  checkbox_label_key text,
  document_url text,
  is_required bool NOT NULL DEFAULT true,
  display_order int4 NOT NULL DEFAULT 0,
  is_active bool NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT study_consent_items_study_id_consent_key_key UNIQUE (study_id, consent_key),
  CONSTRAINT study_consent_items_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE CASCADE
);

ALTER TABLE study_consent_items ENABLE ROW LEVEL SECURITY;
