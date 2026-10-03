-- Index: nárok z vazeb hledá doklady podle (pole, hodnota, typ) a bere jen doc_slug
-- → index-only scan, bez sahání do tabulky. Viz tables/li_doc_scope_keys.sql.
CREATE INDEX IF NOT EXISTS idx_li_doc_scope_keys_hodnota
  ON public.li_doc_scope_keys (field_key, hodnota, doc_type) INCLUDE (doc_slug);
