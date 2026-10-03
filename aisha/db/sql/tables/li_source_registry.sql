-- ============================================================================
-- Source of Truth: li_source_registry
-- Popis: Evidenční registr dokladů z local-ingest (jeden řádek na doklad
--        evidenční třídy — transactional/contractual). Zrcadlí artefakt
--        registry_artifact.jsonl (record_type='registry_record'). Autoritativní
--        pole + pole čekající na revizi + řádkové položky + completeness status.
--        Spravováno: svc-source-broker li-driver přes li_upsert_source_registry.
--        Jediný writer je platforma (service_role za RPC); lokální box píše
--        jen soubory. Idempotence přes source_sha256 (obsahová identita dokladu).
-- RLS: ENABLED (RPC-only lockdown — čtení přes SECURITY DEFINER RPC, ne přímo)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.li_source_registry (
  id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  source_sha256         text         NOT NULL,
  doc_slug              text         NOT NULL,
  story_id              uuid,
  doc_type              text         NOT NULL,
  doc_class             text,
  filename              text,
  status                text         NOT NULL DEFAULT 'REVIEW',
  missing_required      text[]       NOT NULL DEFAULT '{}',
  fields                jsonb        NOT NULL DEFAULT '{}'::jsonb,
  fields_pending_review jsonb        NOT NULL DEFAULT '{}'::jsonb,
  line_items            jsonb        NOT NULL DEFAULT '[]'::jsonb,
  lines_pending_review  integer      NOT NULL DEFAULT 0,
  schema_version        text,
  superseded_by         text,
  -- provenance (audit doktrína: čím a odkud řádek vznikl)
  ingest_source_slug    text         NOT NULL DEFAULT 'local-ingest',
  export_id             text,
  engine_version        text,
  verify_ok             boolean      NOT NULL DEFAULT false,
  raw_data              jsonb,
  -- Umístění binárky: bucket je DATA řádku (píše ho ingest, který ví, kam
  -- objekt uložil) — nikdy konstanta v kódu funkce. Klíč objektu je odvozený
  -- content-addressed: <source_sha256>.pdf. NULL = binárka nebyla uložena.
  storage_bucket        text,
  -- Klíče pro čtečky pod RLS — PROSTÉ sloupce odvozené z `fields` (viz stráž níž).
  counterparty_id_value text GENERATED ALWAYS AS ((fields->'counterparty_id'->>'value')) STORED,
  counterparty_value    text GENERATED ALWAYS AS ((fields->'counterparty'->>'value')) STORED,
  owner_company_value   text GENERATED ALWAYS AS ((fields->'owner_company'->>'value')) STORED,
  ingested_at           timestamptz  NOT NULL DEFAULT now(),
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT li_source_registry_source_sha256_key UNIQUE (source_sha256),
  CONSTRAINT li_source_registry_status_check
    CHECK (status IN ('AUTO_PASS', 'REVIEW'))
);

-- ⛔ KLÍČE PRO ČTEČKY POD RLS (2026-09-29, naměřeno na riq jen čtením): pod RLS smí
-- planner pustit podmínku před politiku (a tedy do Index Cond) JEN když je leakproof.
-- `fields->'x'->>'value'` (jsonb_object_field/_text) ani `fields @> …` leakproof NEJSOU,
-- takže výraz nad `fields` jde vždy seq scanem celé evidence s rozbalováním JSON —
-- expresní i GIN index jsou pro přihlášeného uživatele mrtvé. Karta protistrany:
-- counterparty_resolve 2 706 ms jako admin, tentýž dotaz jako service_role 23 ms.
-- `texteq` na PROSTÉM sloupci leakproof je → Index Scan (throwaway 70 tis. dokladů:
-- resolve 91 → 2,8 ms, člen bez nároku 54 → 6,5 ms, výsledek shodný).
-- Hodnota je TÁŽ jako výraz (vč. NULL u staršího skalárního korpusu) — sloupec je
-- generovaný, nemůže se rozejít s `fields`. Nový klíč pro filtr patří SEM, ne do
-- expresního indexu.
--
-- Stráž: JEDEN ALTER se všemi sloupci = jeden přepis tabulky (tři ALTERy = tři
-- přepisy). `ADD COLUMN IF NOT EXISTS` sám by i nad hotovou tabulkou bral ACCESS
-- EXCLUSIVE zámek při každém migrate — fronta za ním by zastavila čtení registru.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_attribute
       WHERE attrelid = 'public.li_source_registry'::regclass AND NOT attisdropped
         AND attname IN ('counterparty_id_value', 'counterparty_value', 'owner_company_value')) < 3 THEN
    ALTER TABLE public.li_source_registry
      ADD COLUMN IF NOT EXISTS counterparty_id_value text GENERATED ALWAYS AS ((fields->'counterparty_id'->>'value')) STORED,
      ADD COLUMN IF NOT EXISTS counterparty_value    text GENERATED ALWAYS AS ((fields->'counterparty'->>'value')) STORED,
      ADD COLUMN IF NOT EXISTS owner_company_value   text GENERATED ALWAYS AS ((fields->'owner_company'->>'value')) STORED;
  END IF;
END $$;

COMMENT ON TABLE public.li_source_registry IS 'Evidenční registr dokladů z local-ingest (registry_artifact.jsonl), upsert přes li_upsert_source_registry; idempotence přes source_sha256';
COMMENT ON COLUMN public.li_source_registry.source_sha256 IS 'sha256 obsahu dokladu — obsahová identita, dedup klíč pro idempotentní replay';
COMMENT ON COLUMN public.li_source_registry.doc_slug IS 'source_slug z artefaktu = slug dokladu (doc-<sha12>), NE slug datového zdroje';
COMMENT ON COLUMN public.li_source_registry.status IS 'AUTO_PASS = všechna registry_required pole autoritativní; jinak REVIEW (fail-closed)';
COMMENT ON COLUMN public.li_source_registry.superseded_by IS 'doc_slug nahrazujícího dokladu (projekce z links relation=supersedes); NULL = platná verze';
COMMENT ON COLUMN public.li_source_registry.ingest_source_slug IS 'slug datového zdroje (broker cursor) — vždy local-ingest; NE slug dokladu';
COMMENT ON COLUMN public.li_source_registry.counterparty_id_value IS 'fields.counterparty_id.value jako prostý sloupec (generovaný) — filtr podle IČO protistrany jde pod RLS přes index; výraz nad jsonb není leakproof';
COMMENT ON COLUMN public.li_source_registry.counterparty_value IS 'fields.counterparty.value jako prostý sloupec (generovaný) — jméno protistrany pro filtr pod RLS';
COMMENT ON COLUMN public.li_source_registry.owner_company_value IS 'fields.owner_company.value jako prostý sloupec (generovaný) — naše firma bez rozbalování fields (osa firma)';
COMMENT ON COLUMN public.li_source_registry.verify_ok IS 'výsledek offline verify auditu balíčku (fail-closed: driver upsertuje jen verify-gated exporty)';

ALTER TABLE public.li_source_registry ENABLE ROW LEVEL SECURITY;
