-- Index: idx_consent_templates_created_by
-- Table: consent_templates

CREATE INDEX IF NOT EXISTS idx_consent_templates_created_by ON public.consent_templates(created_by);
