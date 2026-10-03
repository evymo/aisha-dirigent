-- Table: consent_templates
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS consent_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  template_key text,
  title_key text,
  content_key text DEFAULT '',
  version text NOT NULL DEFAULT '1.0'::text,
  is_active bool NOT NULL DEFAULT true,
  requires_signature bool NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  code text,
  description_key text,
  name_key text,
  checkbox_label_key text,
  document_url text,
  base_locale text,
  consent_type consent_type,
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT consent_templates_code_key UNIQUE (code),
  CONSTRAINT consent_templates_template_key_key UNIQUE (template_key),
  CONSTRAINT consent_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE consent_templates ENABLE ROW LEVEL SECURITY;
