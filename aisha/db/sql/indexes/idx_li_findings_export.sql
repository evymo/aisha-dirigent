-- Index: idx_li_findings_export
-- Table: li_findings

CREATE INDEX IF NOT EXISTS idx_li_findings_export ON public.li_findings (export_id);
