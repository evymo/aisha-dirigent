-- ============================================================================
-- Source of Truth: li_relation_suggestions
-- Popis: Advisory návrhy VZTAHŮ mezi entitami z local-ingest — zrcadlí
--        entity_relation_artifact.jsonl (record_type='entity_relation') a
--        relation_proposal_artifact.jsonl (record_type='relation_proposal').
--
--        DOKTRÍNA: engine oba druhy razítkuje `advisory: True` s komentářem
--        „doložený vztah, NIKDY automatická vazba". Tahle tabulka je tedy
--        DŮKAZ, ne fakt: z jejích řádků se nikdy negeneruje FK ani
--        `twin_relations`. Vazbu otevře až ratifikace
--        (`twin_relation_open_admin`), která má vlastní autorizaci.
--
--        Proč to existuje: engine vyráběl oba artefakty a driver je NEČETL —
--        síť vazeb se odvodila a zahodila u dveří (naměřeno 2026-08-30:
--        graph_nodes 0, graph_edges 0 při 345 odvozených vztazích). Axiom
--        „story je uzel v síti vazeb" bez přistání vazeb nemá z čeho vzniknout.
--
--        Spravováno: svc-source-broker li-driver přes li_upsert_relation_suggestions.
--        Idempotence přes suggestion_key (druh + parametry + hodnota).
-- RLS: ENABLED (RPC-only lockdown)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.li_relation_suggestions (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_key     text         NOT NULL,
  -- Druh záznamu i druh vztahu jsou VLASTNOSTI, ne výčty (viz CHECK níž).
  record_type        text         NOT NULL,
  relation_kind      text,
  -- Strany vztahu. `entity_relation` popisuje JEDEN parametr sdílený víc
  -- entitami (parameter_a + value, parameter_b NULL); `relation_proposal`
  -- popisuje DVOJICI parametrů (parameter_a + parameter_b, value NULL).
  parameter_a        text         NOT NULL,
  parameter_b        text,
  value              text,
  direction          text,
  -- Naměřená opora. Nezaokrouhlovat na verdikt: bez čísel se návrh nedá
  -- posoudit a rozhodnutí by nebylo učební vzorek, jen klik.
  observations       integer      NOT NULL DEFAULT 0,
  entities_reached   integer,
  -- ⭐ POZOROVÁNO, NE PLATNÉ. Engine měří rozpětí, ve kterém se dvojice v korpusu
  -- POTKÁVALA (`period`), a osu si k tomu ODVODÍ (`time_axis` = nejhustěji
  -- obsazené datumové pole; nezadává se). To NENÍ tvrzení o platnosti vztahu —
  -- platnost vzniká až ratifikací a bydlí v `twin_relations.valid_from/valid_to`.
  --
  -- Proto jiná jména než v cíli: kdyby se tyhle sloupce jmenovaly `valid_*`,
  -- splynul by důkaz s tvrzením a advisory návrh by se četl jako fakt — přesně
  -- ten posun, kterému brání `advisory_check`.
  --
  -- `date`, ne timestamptz: engine emituje ISO DNY (`value[:10]`). Širší typ by
  -- předstíral přesnost, kterou měření nemá. Prázdné u `entity_relation` —
  -- ten druh období nenese.
  observed_from      date,
  observed_to        date,
  time_axis          text,
  -- provenance
  advisory           boolean      NOT NULL DEFAULT true,
  ingest_source_slug text         NOT NULL DEFAULT 'local-ingest',
  export_id          text,
  engine_version     text,
  verify_ok          boolean      NOT NULL DEFAULT false,
  raw_data           jsonb,
  ingested_at        timestamptz  NOT NULL DEFAULT now(),
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT li_relation_suggestions_suggestion_key_key UNIQUE (suggestion_key),

  -- ⭐ DRUH JE VLASTNOST, NE VÝČET — poučeno ze sesterské tabulky.
  --
  -- `li_entity_suggestions` měl tutéž vadu TŘIKRÁT: uzavřený výčet druhů
  -- svázal platformu s enginem do lockstepu a jediný řádek neznámého druhu
  -- odmítl CELÝ balíček 44 320 dokladů. Výčet tu nic nechrání — spotřebitelé
  -- neznámý druh ignorují a doktrínu „advisory, nikdy vazba" drží
  -- `advisory_check`, ne jméno druhu.
  --
  -- Engine je navíc v fázi 1 (`kind='relates_to'` = „tvar, ne význam") a jeho
  -- slovník POROSTE. Kontrolujeme tedy TVAR: neprázdný slug malými písmeny.
  CONSTRAINT li_relation_suggestions_record_type_check
    CHECK (record_type ~ '^[a-z][a-z0-9_]{2,63}$'),
  CONSTRAINT li_relation_suggestions_relation_kind_check
    CHECK (relation_kind IS NULL OR relation_kind ~ '^[a-z][a-z0-9_]{2,63}$'),
  CONSTRAINT li_relation_suggestions_direction_check
    CHECK (direction IS NULL OR direction ~ '^[a-z][a-z0-9_]{2,63}$'),
  CONSTRAINT li_relation_suggestions_advisory_check
    CHECK (advisory = true)
);

COMMENT ON TABLE public.li_relation_suggestions IS 'Advisory návrhy vztahů mezi entitami z local-ingest (entity_relation + relation_proposal); NIKDY se z nich negeneruje FK/vazba — vazbu otevře až ratifikace';
COMMENT ON COLUMN public.li_relation_suggestions.suggestion_key IS 'Deterministický dedup klíč (druh + parametry + hodnota) — počítá li_upsert_relation_suggestions';
COMMENT ON COLUMN public.li_relation_suggestions.advisory IS 'Vždy true (CHECK) — pojistka doktríny: doložený vztah, nikdy automatická vazba';
COMMENT ON COLUMN public.li_relation_suggestions.raw_data IS 'Celý záznam enginu — sloupce výš jsou jen to, na co se filtruje';
COMMENT ON COLUMN public.li_relation_suggestions.observed_from IS 'První den, kdy se dvojice v korpusu potkala — DŮKAZ, ne platnost (platnost nese twin_relations.valid_from)';
COMMENT ON COLUMN public.li_relation_suggestions.observed_to IS 'Poslední den, kdy se dvojice v korpusu potkala — DŮKAZ, ne platnost';
COMMENT ON COLUMN public.li_relation_suggestions.time_axis IS 'Pole, ze kterého engine osu ODVODIL (nejhustěji obsazené datumové pole) — bez něj se období nedá interpretovat';

ALTER TABLE public.li_relation_suggestions ENABLE ROW LEVEL SECURITY;
