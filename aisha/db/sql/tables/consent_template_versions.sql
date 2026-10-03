-- Table: consent_template_versions
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS consent_template_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  consent_template_id uuid NOT NULL,
  version int4 NOT NULL,
  consent_type consent_type,
  title_key text NOT NULL,
  description_key text,
  checkbox_label_key text NOT NULL,
  document_url text,
  requires_signature bool NOT NULL DEFAULT false,
  base_locale text NOT NULL,
  is_active bool NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT consent_template_versions_consent_template_id_version_key UNIQUE (version, consent_template_id),
  CONSTRAINT consent_template_versions_base_locale_fkey FOREIGN KEY (base_locale) REFERENCES supported_languages(code),
  CONSTRAINT consent_template_versions_consent_template_id_fkey FOREIGN KEY (consent_template_id) REFERENCES consent_templates(id) ON DELETE CASCADE
);

ALTER TABLE consent_template_versions ENABLE ROW LEVEL SECURITY;
