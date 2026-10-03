-- Index: idx_li_links_export
-- Table: li_links

CREATE INDEX IF NOT EXISTS idx_li_links_export ON public.li_links (export_id);
