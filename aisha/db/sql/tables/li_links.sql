-- ============================================================================
-- Source of Truth: li_links
-- Popis: Doložené vazby mezi doklady z local-ingest — zrcadlí
--        links_artifact.jsonl (record_type='link'). Deklarativní párování
--        (faktura↔dodací list, faktura↔platba, dodatek supersedes smlouvu).
--        relation=supersedes je zdroj projekce „platná verze" do registru.
--        Spravováno: svc-source-broker li-driver přes li_upsert_links.
--        Idempotence přes link_key (rule_id + from_sha + to_sha + relation).
-- RLS: ENABLED (RPC-only lockdown)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.li_links (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  link_key           text         NOT NULL,
  rule_key           text,
  relation           text,
  from_sha256        text         NOT NULL,
  from_slug          text,
  from_doc_type      text,
  to_sha256          text         NOT NULL,
  to_slug            text,
  to_doc_type        text,
  matched_by         jsonb        NOT NULL DEFAULT '[]'::jsonb,
  -- provenance
  ingest_source_slug text         NOT NULL DEFAULT 'local-ingest',
  export_id          text,
  engine_version     text,
  verify_ok          boolean      NOT NULL DEFAULT false,
  raw_data           jsonb,
  ingested_at        timestamptz  NOT NULL DEFAULT now(),
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT li_links_link_key_key UNIQUE (link_key)
);

COMMENT ON TABLE public.li_links IS 'Doložené vazby mezi doklady z local-ingest (links_artifact.jsonl); relation=supersedes → projekce platné verze do registru';
COMMENT ON COLUMN public.li_links.link_key IS 'Deterministický dedup klíč (rule_id + from_sha256 + to_sha256 + relation) — počítá li_upsert_links';
COMMENT ON COLUMN public.li_links.rule_key IS 'TEXT slug pravidla z local-ingest (export wire-pole rule_id) — NENÍ uuid FK na expert_rules; proto rule_key, ne rule_id';
COMMENT ON COLUMN public.li_links.relation IS 'Sémantika vazby (např. supersedes) — nepovinná; supersedes řídí projekci platné verze';
COMMENT ON COLUMN public.li_links.matched_by IS 'Evidence shody (které podmínky/pole match — auditní stopa)';

ALTER TABLE public.li_links ENABLE ROW LEVEL SECURITY;
