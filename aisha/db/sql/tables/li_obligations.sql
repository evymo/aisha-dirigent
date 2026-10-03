-- ============================================================================
-- Source of Truth: li_obligations
-- Popis: Registr závazků z ustanovení smluv (local-ingest E5) — zrcadlí
--        obligations_artifact.jsonl (record_type='obligation'). Každý závazek
--        nese VERBATIM citaci (quote) + absolutní span zpět na článek.
--        candidate_status je VŽDY NEEDS_REVIEW: právně významný obsah se nikdy
--        nestává autoritativním bez člověka (promoce jen přes review flow).
--        Spravováno: svc-source-broker li-driver přes li_upsert_obligations.
--        Idempotence přes obligation_key (source_sha256 + span + rule_id).
-- RLS: ENABLED (RPC-only lockdown)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.li_obligations (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_key     text         NOT NULL,
  source_sha256      text         NOT NULL,
  doc_slug           text,
  filename           text,
  rule_key           text,
  clause_ref         text,
  clause_title       text,
  quote              text         NOT NULL,
  char_start         integer,
  char_end           integer,
  page               integer,
  obliged_party      text,
  action             text,
  deadline_text      text,
  consequence_text   text,
  candidate_status   text         NOT NULL DEFAULT 'NEEDS_REVIEW',
  -- provenance
  ingest_source_slug text         NOT NULL DEFAULT 'local-ingest',
  export_id          text,
  engine_version     text,
  verify_ok          boolean      NOT NULL DEFAULT false,
  raw_data           jsonb,
  ingested_at        timestamptz  NOT NULL DEFAULT now(),
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT li_obligations_obligation_key_key UNIQUE (obligation_key),
  CONSTRAINT li_obligations_candidate_status_check
    CHECK (candidate_status IN ('NEEDS_REVIEW', 'HUMAN_CONFIRMED', 'REJECTED'))
);

COMMENT ON TABLE public.li_obligations IS 'Registr závazků z local-ingest (obligations_artifact.jsonl); právní obsah: default NEEDS_REVIEW, HUMAN_CONFIRMED jen přes review flow';
COMMENT ON COLUMN public.li_obligations.obligation_key IS 'Deterministický dedup klíč (source_sha256 + char_start + char_end + rule_id) — počítá li_upsert_obligations';
COMMENT ON COLUMN public.li_obligations.rule_key IS 'TEXT slug pravidla z local-ingest (export wire-pole rule_id) — NENÍ uuid FK na expert_rules; proto rule_key, ne rule_id';
COMMENT ON COLUMN public.li_obligations.quote IS 'VERBATIM citace ustanovení (pravda); interpretace (obliged_party/action/deadline) je oddělený návrh';
COMMENT ON COLUMN public.li_obligations.candidate_status IS 'Vždy NEEDS_REVIEW z importu; HUMAN_CONFIRMED nastaví jedině review RPC (nikdy driver)';

ALTER TABLE public.li_obligations ENABLE ROW LEVEL SECURITY;
