-- ============================================================================
-- Source of Truth: li_findings
-- Popis: Deterministické nálezy (nesoulady) z cross-document kontrol
--        local-ingest — zrcadlí findings_artifact.jsonl (record_type='finding').
--        Např. missing_counterpart, date_out_of_window, price_mismatch,
--        missing_line_item. Alert engine čte odsud.
--        Spravováno: svc-source-broker li-driver přes li_upsert_findings.
--        Idempotence přes finding_key (deterministický z rule_id + finding +
--        dotčených dokladů) — počítá RPC, driver je tenký mapper.
-- RLS: ENABLED (RPC-only lockdown)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.li_findings (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_key        text         NOT NULL,
  rule_key           text,
  finding            text         NOT NULL,
  severity           text,
  documents          jsonb        NOT NULL DEFAULT '[]'::jsonb,
  evidence           jsonb,
  -- provenance
  ingest_source_slug text         NOT NULL DEFAULT 'local-ingest',
  export_id          text,
  engine_version     text,
  verify_ok          boolean      NOT NULL DEFAULT false,
  raw_data           jsonb,
  ingested_at        timestamptz  NOT NULL DEFAULT now(),
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT li_findings_finding_key_key UNIQUE (finding_key),
  CONSTRAINT li_findings_severity_check
    CHECK (severity IS NULL OR severity IN ('low', 'medium', 'high'))
);

COMMENT ON TABLE public.li_findings IS 'Deterministické nálezy z local-ingest cross-document kontrol (findings_artifact.jsonl); alert engine čte odsud';
COMMENT ON COLUMN public.li_findings.finding_key IS 'Deterministický dedup klíč (rule_id + finding + seřazené sha dotčených dokladů) — počítá li_upsert_findings';
COMMENT ON COLUMN public.li_findings.finding IS 'Druh nálezu: missing_counterpart / date_out_of_window / missing_line_item / <rule.id> (např. price_mismatch)';
COMMENT ON COLUMN public.li_findings.rule_key IS 'TEXT slug pravidla z local-ingest (export wire-pole rule_id, např. price_mismatch) — NENÍ uuid FK na expert_rules; proto rule_key, ne rule_id';
COMMENT ON COLUMN public.li_findings.documents IS 'Dotčené doklady [{source_sha256, source_slug, filename}] — evidence, ne akce';

ALTER TABLE public.li_findings ENABLE ROW LEVEL SECURITY;
