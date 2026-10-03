-- Index: idx_consent_template_versions_base_locale
-- Table: consent_template_versions

CREATE INDEX IF NOT EXISTS idx_consent_template_versions_base_locale ON public.consent_template_versions(base_locale);
