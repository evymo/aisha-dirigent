-- Table: contract_register
-- Evidence layer (E5): structured contract extract per registered document.
-- Extraction is confidence-scored and NEVER authoritative without a human:
-- re-extract drops human_verified (enforced in upsert_contract_extract_audited).
-- NOTE: maintenance_contracts is Stripe billing — deliberately NOT reused here.

CREATE TABLE IF NOT EXISTS public.contract_register (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  document_id uuid NOT NULL,
  counterparty text,
  subject text,
  valid_from date,
  valid_to date,
  extract jsonb DEFAULT '{}'::jsonb NOT NULL,
  confidence numeric,
  human_verified boolean DEFAULT false NOT NULL,
  verified_by uuid,
  verified_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT contract_register_document_key UNIQUE (document_id),
  CONSTRAINT contract_register_document_fk FOREIGN KEY (document_id) REFERENCES public.document_registry(id),
  CONSTRAINT contract_register_confidence_range CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT contract_register_validity_order CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to),
  CONSTRAINT contract_register_verified_consistency CHECK (NOT human_verified OR verified_at IS NOT NULL)
);

ALTER TABLE public.contract_register ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.contract_register IS
  'Structured contract extracts (confidence 0-1, span-provenanced in extract jsonb). human_verified is dropped on re-extract.';
