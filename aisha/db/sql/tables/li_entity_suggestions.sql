-- ============================================================================
-- Source of Truth: li_entity_suggestions
-- Popis: Advisory návrhy sjednocení názvů protistran z local-ingest (E4) —
--        zrcadlí entity_suggestions_artifact.jsonl (record_type=
--        'entity_suggestion'). same_id_multiple_names / same_name_multiple_ids.
--        DOKTRÍNA: „Fuzzy sjednocení názvů entit smí být advisory návrh, NIKDY
--        automatická vazba" — z těchto řádků se NIKDY negeneruje FK/vazba.
--        Spravováno: svc-source-broker li-driver přes li_upsert_entity_suggestions.
--        Idempotence přes suggestion_key (suggestion + pole + hodnota).
-- RLS: ENABLED (RPC-only lockdown)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.li_entity_suggestions (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_key     text         NOT NULL,
  suggestion         text         NOT NULL,
  id_field           text,
  id_value           text,
  name_field         text,
  name_normalized    text,
  names              text[]       NOT NULL DEFAULT '{}',
  ids                text[]       NOT NULL DEFAULT '{}',
  documents          text[]       NOT NULL DEFAULT '{}',
  advisory           boolean      NOT NULL DEFAULT true,
  -- provenance
  ingest_source_slug text         NOT NULL DEFAULT 'local-ingest',
  export_id          text,
  engine_version     text,
  verify_ok          boolean      NOT NULL DEFAULT false,
  raw_data           jsonb,
  ingested_at        timestamptz  NOT NULL DEFAULT now(),
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT li_entity_suggestions_suggestion_key_key UNIQUE (suggestion_key),
  -- ⭐ DRUH NÁVRHU JE VLASTNOST, NE VÝČET — a je to oprava POTŘETÍ.
  --
  -- Historie téže vady: 07-31 znal CHECK dva druhy a ingest vydával čtyři
  -- (rozšířeno RUKOU v produkci, SoT pozadu); 08-03 vydává PĚT
  -- (`value_shape_foreign_to_field` = hodnota tvarem patří do jiného pole)
  -- a čtyřprvkový výčet odmítl CELÝ balíček 44 320 dokladů — jediný řádek
  -- neznámého druhu zastavil replay evidence i KB.
  --
  -- Uzavřený výčet svazuje platformu s enginem do lockstepu: každý nový nález
  -- ingestu si žádá migraci a do té doby NEPROJDE NIC. Přitom výčet tu nic
  -- nechrání — nikdo na hodnotu nespíná (`li_upsert_entity_suggestions` klíčuje
  -- obecně přes `question_id`, spotřebitelé neznámý druh ignorují) a doktrínu
  -- „advisory, nikdy vazba" drží `advisory_check`, ne jméno nálezu.
  --
  -- Kontrolujeme tedy TVAR: neprázdný slug malými písmeny. To odmítne nepořádek
  -- (prázdno, mezery, HTML, verzálky) a nechá slovník enginu růst. Brána má
  -- testovat vlastnost, ne pravopis.
  CONSTRAINT li_entity_suggestions_suggestion_check
    CHECK (suggestion ~ '^[a-z][a-z0-9_]{2,63}$'),
  CONSTRAINT li_entity_suggestions_advisory_check
    CHECK (advisory = true)
);

COMMENT ON TABLE public.li_entity_suggestions IS 'Advisory návrhy sjednocení entit z local-ingest (entity_suggestions_artifact.jsonl); NIKDY se z nich negeneruje FK/vazba';
COMMENT ON COLUMN public.li_entity_suggestions.suggestion_key IS 'Deterministický dedup klíč (suggestion + id/name field + hodnota) — počítá li_upsert_entity_suggestions';
COMMENT ON COLUMN public.li_entity_suggestions.advisory IS 'Vždy true (CHECK) — pojistka doktríny: advisory návrh, nikdy automatická vazba';

ALTER TABLE public.li_entity_suggestions ENABLE ROW LEVEL SECURITY;
