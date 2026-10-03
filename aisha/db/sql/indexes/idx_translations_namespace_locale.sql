-- Index: idx_translations_namespace_locale
-- Table: translations

CREATE INDEX IF NOT EXISTS idx_translations_namespace_locale
  ON public.translations USING btree (namespace, locale);
