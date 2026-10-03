-- Index: idx_li_links_to
-- Table: li_links

CREATE INDEX IF NOT EXISTS idx_li_links_to ON public.li_links (to_sha256);
