-- Table: document_registry
-- Evidence layer (E3): every ingested document gets exactly one registry row per
-- content version. Dedup on (source_id, source_sha256); superseded_by chains
-- document versions (amendments, re-issues) without ever rewriting the original.

CREATE TABLE IF NOT EXISTS public.document_registry (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  source_id uuid NOT NULL,
  source_sha256 text NOT NULL,
  doc_type text NOT NULL,
  title text,
  doc_date date,
  counterparty text,
  sensitivity text NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  superseded_by uuid,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT document_registry_dedup UNIQUE (source_id, source_sha256),
  CONSTRAINT document_registry_source_fk FOREIGN KEY (source_id) REFERENCES public.agent_knowledge_sources(id),
  CONSTRAINT document_registry_superseded_fk FOREIGN KEY (superseded_by) REFERENCES public.document_registry(id),
  CONSTRAINT document_registry_sha256_format CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT document_registry_doc_type_valid CHECK (
    doc_type IN ('invoice','delivery_note','order','contract','amendment','statement','report','certificate','communication','other')
  ),
  CONSTRAINT document_registry_sensitivity_valid CHECK (
    sensitivity IN ('public','internal','restricted','confidential')
  ),
  CONSTRAINT document_registry_version_positive CHECK (version >= 1)
);

ALTER TABLE public.document_registry ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.document_registry IS
  'Evidence registry: one row per (source, content hash). Originals are never rewritten; superseded_by chains versions.';
