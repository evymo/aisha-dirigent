-- Table: agent_knowledge_sources
-- Source-of-truth registry of knowledge sources (materializes the long-standing
-- "phantom" state entry). Rows are instance data (per-implementation seed).
-- 4D classification lives in config (source_type, data_sensitivity,
-- retention_class, legal_basis — Source Onboarding Contract §1); the activation
-- guard makes a source activatable ONLY with a complete classification plus a
-- declared owner (§3) — fail-closed onboarding.
--
-- ⛔ NAMĚŘENO 2026-09-20: závora a kontrakt se NESHODOVALY. Závora vyžadovala
-- `data_sensitivity`, `legal_basis`, `owner`, `retention`, kdežto kontrakt §1
-- předepisuje `source_type`, `data_sensitivity`, `retention_class`,
-- `legal_basis`. Důsledek: kdo se řídil kontraktem a napsal `retention_class`,
-- zdroj NEZAPNUL; kdo se řídil závorou, zapnul ho BEZ `source_type` — přitom
-- právě podle něj kontrakt §4 rozhoduje, zda je potřeba souhlas uživatele
-- (`user_provided`), DPA s partnerem (`partner`), smluvní základ (`external`),
-- nebo stačí oprávněný zájem (`internal`). Rozpor přežil proto, že vynucovací
-- brána `enterprise-source-hosting` měří jen EXISTENCI SEKCÍ V DOKUMENTU, ne
-- chování kódu. Vyhrál kontrakt (rozhodnutí vlastníka 2026-09-20); v celé
-- platformě byla v té době 0 řádků, takže se to srovnalo bez migrace dat.
--
-- Hodnotové CHECKy jsou u všech čtyř dimenzí, ne jen u citlivosti: dimenze bez
-- povolené množiny je volný text, a volný text v klasifikaci znamená, že se
-- podle ní nedá nic vynutit.

CREATE TABLE IF NOT EXISTS public.agent_knowledge_sources (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  source_slug text NOT NULL,
  namespace text NOT NULL,
  is_active boolean DEFAULT false NOT NULL,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- Provenance: NULL = seeded/operator-declared source; non-NULL = materialized
  -- from an approved marketplace plugin (kind='data_source'). Ownership guard —
  -- materialize_data_source only updates a row it already owns. Activation stays
  -- fail-closed either way (4D classification guard below).
  source_plugin_id uuid REFERENCES public.plugin_catalog(id) ON DELETE SET NULL,
  -- Kontext zdroje. Story se NEZADÁVÁ do konfigurace ingestu — věc, o které
  -- story je, si ji drží, a `ensure_source_story(source_slug)` ji najde nebo
  -- založí (týž tvar jako `production_batches.story_id`). Dokud byl kořen UUID
  -- vypsané do `impl.json`, balíček nepřežil přestavbu DB: 3 822 řádků mířilo
  -- na story s nula řádky (naměřeno 2026-08-30).
  -- ON DELETE SET NULL: smazaná story zdroj neruší, jen ho nechá bez kontextu,
  -- takže další běh si ho založí znovu.
  story_id uuid REFERENCES public.partner_stories(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT agent_knowledge_sources_slug_key UNIQUE (source_slug),
  CONSTRAINT agent_knowledge_sources_slug_format CHECK (source_slug ~ '^[a-z0-9][a-z0-9_-]*$'),
  CONSTRAINT agent_knowledge_sources_namespace_format CHECK (namespace ~ '^[a-z0-9][a-z0-9_-]*(/[a-z0-9][a-z0-9_-]*)+$'),
  CONSTRAINT agent_knowledge_sources_sensitivity_valid CHECK (
    NOT (config ? 'data_sensitivity')
    OR config->>'data_sensitivity' IN ('public','internal','restricted','confidential')
  ),
  CONSTRAINT agent_knowledge_sources_source_type_valid CHECK (
    NOT (config ? 'source_type')
    OR config->>'source_type' IN ('internal','partner','external','user_provided')
  ),
  CONSTRAINT agent_knowledge_sources_retention_class_valid CHECK (
    NOT (config ? 'retention_class')
    OR config->>'retention_class' IN ('ephemeral','short_term','long_term','permanent')
  ),
  CONSTRAINT agent_knowledge_sources_legal_basis_valid CHECK (
    NOT (config ? 'legal_basis')
    OR config->>'legal_basis' IN ('consent','contract','legitimate_interest','legal_obligation')
  ),
  CONSTRAINT agent_knowledge_sources_activation_guard CHECK (
    NOT is_active
    OR (config ? 'source_type' AND config ? 'data_sensitivity'
        AND config ? 'retention_class' AND config ? 'legal_basis'
        AND config ? 'owner')
  )
);

ALTER TABLE public.agent_knowledge_sources ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.agent_knowledge_sources IS
  'SoT registry of knowledge sources. Activation requires the contract 4D classification (source_type, data_sensitivity, retention_class, legal_basis) plus owner in config — fail-closed.';
