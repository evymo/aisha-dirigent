-- Index: idx_li_links_from
-- Table: li_links

CREATE INDEX IF NOT EXISTS idx_li_links_from ON public.li_links (from_sha256);
