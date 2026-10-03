-- Index: čtení dvojčat v rozsahu bere protistrany dokladů v rozsahu podle doc_slug.
CREATE INDEX IF NOT EXISTS idx_li_doc_scope_keys_doc_slug
  ON public.li_doc_scope_keys (doc_slug, field_key) INCLUDE (hodnota);
