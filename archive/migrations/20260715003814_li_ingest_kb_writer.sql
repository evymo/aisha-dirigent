-- ============================================================================
-- local-ingest KB-writer platform half (W3) — li_* SoT + audited upsert RPCs
-- ============================================================================
-- Producer→consumer wiring pro aisha-local-ingest: SoT tabulky (RLS) pro
-- evidenční vrstvu (registry / findings / links / obligations / entity
-- suggestions) + SECURITY DEFINER upsert RPC jako JEDINÝ writer, volaný
-- service_role z li-driveru v svc-source-broker. KB items jedou beze změny DDL
-- přes existující upsert_story_knowledge_item_audited + insert_knowledge_chunk;
-- authz KB upsertu se rozšiřuje o service_role (jinak by čistý service_role
-- driver call padl na is_admin_or_staff(NULL)=false a KB cesta by byla mrtvá).
--
-- Idempotence: registry přes source_sha256; ostatní přes deterministický
-- <x>_key počítaný v RPC (driver zůstává tenký mapper). Provenance: source
-- sha256, verify_ok (fail-closed — jen verify-gated exporty), export_id,
-- engine_version, ingested_at.
--
-- Source of truth pair:
--   aisha/db/sql/tables/li_source_registry.sql
--   aisha/db/sql/tables/li_findings.sql
--   aisha/db/sql/tables/li_links.sql
--   aisha/db/sql/tables/li_obligations.sql
--   aisha/db/sql/tables/li_entity_suggestions.sql
--   aisha/db/sql/constraints/fk_li_source_registry_story.sql
--   aisha/db/sql/functions/li_upsert_source_registry.sql
--   aisha/db/sql/functions/li_upsert_findings.sql
--   aisha/db/sql/functions/li_upsert_links.sql
--   aisha/db/sql/functions/li_upsert_obligations.sql
--   aisha/db/sql/functions/li_upsert_entity_suggestions.sql
--   aisha/db/sql/functions/upsert_story_knowledge_item_audited.sql (authz delta)
--
-- Související specs:
--   docs/planning/INGEST_POTOK_STACK_INTEGRATION_PLAN.md  (§W3)
--   packages/local-ingest/docs/STACK_INTEGRATION.md
-- ============================================================================

-- ── SoT tabulky ─────────────────────────────────────────────────────────────

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
  ingest_source_slug    text         NOT NULL DEFAULT 'local-ingest',
  export_id             text,
  engine_version        text,
  verify_ok             boolean      NOT NULL DEFAULT false,
  raw_data              jsonb,
  ingested_at           timestamptz  NOT NULL DEFAULT now(),
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT li_source_registry_source_sha256_key UNIQUE (source_sha256),
  CONSTRAINT li_source_registry_status_check
    CHECK (status IN ('AUTO_PASS', 'REVIEW'))
);
CREATE INDEX IF NOT EXISTS idx_li_source_registry_story ON public.li_source_registry (story_id);
CREATE INDEX IF NOT EXISTS idx_li_source_registry_doc_type ON public.li_source_registry (doc_type);
CREATE INDEX IF NOT EXISTS idx_li_source_registry_status ON public.li_source_registry (status);
CREATE INDEX IF NOT EXISTS idx_li_source_registry_export ON public.li_source_registry (export_id);
ALTER TABLE public.li_source_registry ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.li_findings (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_key        text         NOT NULL,
  rule_id            text,
  finding            text         NOT NULL,
  severity           text,
  documents          jsonb        NOT NULL DEFAULT '[]'::jsonb,
  evidence           jsonb,
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
CREATE INDEX IF NOT EXISTS idx_li_findings_finding ON public.li_findings (finding);
CREATE INDEX IF NOT EXISTS idx_li_findings_severity ON public.li_findings (severity);
CREATE INDEX IF NOT EXISTS idx_li_findings_export ON public.li_findings (export_id);
ALTER TABLE public.li_findings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.li_links (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  link_key           text         NOT NULL,
  rule_id            text,
  relation           text,
  from_sha256        text         NOT NULL,
  from_slug          text,
  from_doc_type      text,
  to_sha256          text         NOT NULL,
  to_slug            text,
  to_doc_type        text,
  matched_by         jsonb        NOT NULL DEFAULT '[]'::jsonb,
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
CREATE INDEX IF NOT EXISTS idx_li_links_from ON public.li_links (from_sha256);
CREATE INDEX IF NOT EXISTS idx_li_links_to ON public.li_links (to_sha256);
CREATE INDEX IF NOT EXISTS idx_li_links_relation ON public.li_links (relation);
CREATE INDEX IF NOT EXISTS idx_li_links_export ON public.li_links (export_id);
ALTER TABLE public.li_links ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.li_obligations (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_key     text         NOT NULL,
  source_sha256      text         NOT NULL,
  doc_slug           text,
  filename           text,
  rule_id            text,
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
CREATE INDEX IF NOT EXISTS idx_li_obligations_source ON public.li_obligations (source_sha256);
CREATE INDEX IF NOT EXISTS idx_li_obligations_status ON public.li_obligations (candidate_status);
CREATE INDEX IF NOT EXISTS idx_li_obligations_export ON public.li_obligations (export_id);
ALTER TABLE public.li_obligations ENABLE ROW LEVEL SECURITY;

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
  ingest_source_slug text         NOT NULL DEFAULT 'local-ingest',
  export_id          text,
  engine_version     text,
  verify_ok          boolean      NOT NULL DEFAULT false,
  raw_data           jsonb,
  ingested_at        timestamptz  NOT NULL DEFAULT now(),
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT li_entity_suggestions_suggestion_key_key UNIQUE (suggestion_key),
  CONSTRAINT li_entity_suggestions_suggestion_check
    CHECK (suggestion IN ('same_id_multiple_names', 'same_name_multiple_ids')),
  CONSTRAINT li_entity_suggestions_advisory_check
    CHECK (advisory = true)
);
CREATE INDEX IF NOT EXISTS idx_li_entity_suggestions_suggestion ON public.li_entity_suggestions (suggestion);
CREATE INDEX IF NOT EXISTS idx_li_entity_suggestions_export ON public.li_entity_suggestions (export_id);
ALTER TABLE public.li_entity_suggestions ENABLE ROW LEVEL SECURITY;

-- ── FK allowlist ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_li_source_registry_story'
  ) THEN
    ALTER TABLE public.li_source_registry
      ADD CONSTRAINT fk_li_source_registry_story
      FOREIGN KEY (story_id)
      REFERENCES public.partner_stories(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ── audited upsert RPC (jediný writer) — plné tělo (shodné se SoT) ─────────
-- Po db:init:generate se tyto objekty absorbují do baseline; do té doby jsou
-- delta pro nasazené DB. Idempotentní (CREATE OR REPLACE / CREATE IF NOT EXISTS).

-- ============================================================================
-- Source of Truth: li_upsert_source_registry
-- Popis: Batch upsert evidenčního registru dokladů z local-ingest. Volá
--        svc-source-broker li-driver po přečtení verify-gated export balíčku.
--        Idempotence přes source_sha256 (obsahová identita dokladu) — replay
--        téhož exportu nevytvoří duplicity. Jediný writer registru (RPC-only).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; service_role / admin / staff.
-- Audit: li_source_registry.upsert_completed s počty (bez PII).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.li_upsert_source_registry(
  p_rows           jsonb,
  p_export_id      text DEFAULT NULL,
  p_engine_version text DEFAULT NULL,
  p_verify_ok      boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- Kanonický boolean-NOT-NULL service check (is_service_role.sql, #588):
  -- deny-guard níže tak fail-CLOSED i bez role claimu.
  v_is_service boolean := public.is_service_role();
  v_batch      jsonb;
  v_total      integer;
  v_updated    integer;
  v_inserted   integer;
BEGIN
  -- Authorization (FIRST, před jakýmkoli přístupem k datům)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  -- Input validation
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a jsonb array';
  END IF;

  -- Dedup podle source_sha256 — ON CONFLICT nesmí zasáhnout stejný řádek dvakrát.
  -- Poslední výskyt v dávce vyhrává (DISTINCT ON drží první po ORDER, viz níže).
  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON (item->>'source_sha256') item
    FROM jsonb_array_elements(p_rows) AS item
    WHERE item->>'source_sha256' IS NOT NULL
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.li_source_registry r
  WHERE r.source_sha256 IN (
    SELECT item->>'source_sha256'
    FROM jsonb_array_elements(v_batch) AS item
  );

  INSERT INTO public.li_source_registry (
    source_sha256, doc_slug, story_id, doc_type, doc_class, filename, status,
    missing_required, fields, fields_pending_review, line_items,
    lines_pending_review, schema_version, superseded_by,
    export_id, engine_version, verify_ok, raw_data, ingested_at, updated_at
  )
  SELECT
    item->>'source_sha256',
    item->>'source_slug',
    NULLIF(item->>'story_id', '')::uuid,
    item->>'doc_type',
    item->>'doc_class',
    item->>'filename',
    COALESCE(item->>'status', 'REVIEW'),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(item->'missing_required')),
      '{}'::text[]
    ),
    COALESCE(item->'fields', '{}'::jsonb),
    COALESCE(item->'fields_pending_review', '{}'::jsonb),
    COALESCE(item->'line_items', '[]'::jsonb),
    COALESCE((item->>'lines_pending_review')::integer, 0),
    item->>'schema_version',
    item->>'superseded_by',
    p_export_id,
    p_engine_version,
    p_verify_ok,
    item,
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (source_sha256) DO UPDATE SET
    doc_slug             = EXCLUDED.doc_slug,
    story_id             = EXCLUDED.story_id,
    doc_type             = EXCLUDED.doc_type,
    doc_class            = EXCLUDED.doc_class,
    filename             = EXCLUDED.filename,
    status               = EXCLUDED.status,
    missing_required     = EXCLUDED.missing_required,
    fields               = EXCLUDED.fields,
    fields_pending_review = EXCLUDED.fields_pending_review,
    line_items           = EXCLUDED.line_items,
    lines_pending_review = EXCLUDED.lines_pending_review,
    schema_version       = EXCLUDED.schema_version,
    superseded_by        = EXCLUDED.superseded_by,
    export_id            = EXCLUDED.export_id,
    engine_version       = EXCLUDED.engine_version,
    verify_ok            = EXCLUDED.verify_ok,
    raw_data             = EXCLUDED.raw_data,
    ingested_at          = EXCLUDED.ingested_at,
    updated_at           = now();

  v_inserted := v_total - v_updated;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'li_source_registry.upsert_completed',
    jsonb_build_object(
      'export_id', p_export_id,
      'engine_version', p_engine_version,
      'verify_ok', p_verify_ok,
      'total', v_total,
      'inserted', v_inserted,
      'updated', v_updated
    )
  );

  RETURN jsonb_build_object(
    'total', v_total,
    'inserted', v_inserted,
    'updated', v_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.li_upsert_source_registry(jsonb, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_upsert_source_registry(jsonb, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_upsert_source_registry(jsonb, text, text, boolean) TO service_role;

-- ============================================================================
-- Source of Truth: li_upsert_findings
-- Popis: Batch upsert deterministických nálezů z local-ingest. Volá
--        svc-source-broker li-driver z findings_artifact.jsonl. finding_key
--        (dedup) počítá RPC z rule_id + finding + seřazených sha dotčených
--        dokladů — driver zůstává tenký mapper, idempotence je server-side.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; service_role / admin / staff.
-- Audit: li_findings.upsert_completed s počty (bez PII).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.li_upsert_findings(
  p_rows           jsonb,
  p_export_id      text DEFAULT NULL,
  p_engine_version text DEFAULT NULL,
  p_verify_ok      boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean := public.is_service_role();
  v_keyed      jsonb;
  v_batch      jsonb;
  v_total      integer;
  v_updated    integer;
  v_inserted   integer;
BEGIN
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a jsonb array';
  END IF;

  -- finding_key = md5(rule_id | finding | seřazené sha dokladů). Seřazení sha
  -- činí klíč nezávislý na pořadí dokumentů v poli (stabilní napříč exporty).
  SELECT COALESCE(jsonb_agg(
    item || jsonb_build_object('_finding_key', md5(
      COALESCE(item->>'rule_id', '') || '|' ||
      COALESCE(item->>'finding', '') || '|' ||
      COALESCE((
        SELECT string_agg(doc->>'source_sha256', ',' ORDER BY doc->>'source_sha256')
        FROM jsonb_array_elements(COALESCE(item->'documents', '[]'::jsonb)) AS doc
        WHERE doc->>'source_sha256' IS NOT NULL
      ), '')
    ))
  ), '[]'::jsonb) INTO v_keyed
  FROM jsonb_array_elements(p_rows) AS item
  WHERE item->>'finding' IS NOT NULL;

  -- Dedup v dávce podle vypočteného klíče (poslední výskyt vyhrává).
  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON (item->>'_finding_key') item
    FROM jsonb_array_elements(v_keyed) AS item
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.li_findings f
  WHERE f.finding_key IN (
    SELECT item->>'_finding_key'
    FROM jsonb_array_elements(v_batch) AS item
  );

  INSERT INTO public.li_findings (
    finding_key, rule_id, finding, severity, documents, evidence,
    export_id, engine_version, verify_ok, raw_data, ingested_at, updated_at
  )
  SELECT
    item->>'_finding_key',
    item->>'rule_id',
    item->>'finding',
    item->>'severity',
    COALESCE(item->'documents', '[]'::jsonb),
    item->'evidence',
    p_export_id,
    p_engine_version,
    p_verify_ok,
    item - '_finding_key',
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (finding_key) DO UPDATE SET
    rule_id        = EXCLUDED.rule_id,
    finding        = EXCLUDED.finding,
    severity       = EXCLUDED.severity,
    documents      = EXCLUDED.documents,
    evidence       = EXCLUDED.evidence,
    export_id      = EXCLUDED.export_id,
    engine_version = EXCLUDED.engine_version,
    verify_ok      = EXCLUDED.verify_ok,
    raw_data       = EXCLUDED.raw_data,
    ingested_at    = EXCLUDED.ingested_at,
    updated_at     = now();

  v_inserted := v_total - v_updated;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'li_findings.upsert_completed',
    jsonb_build_object(
      'export_id', p_export_id,
      'engine_version', p_engine_version,
      'verify_ok', p_verify_ok,
      'total', v_total,
      'inserted', v_inserted,
      'updated', v_updated
    )
  );

  RETURN jsonb_build_object(
    'total', v_total,
    'inserted', v_inserted,
    'updated', v_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.li_upsert_findings(jsonb, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_upsert_findings(jsonb, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_upsert_findings(jsonb, text, text, boolean) TO service_role;

-- ============================================================================
-- Source of Truth: li_upsert_links
-- Popis: Batch upsert doložených vazeb mezi doklady z local-ingest. Volá
--        svc-source-broker li-driver z links_artifact.jsonl. link_key (dedup)
--        počítá RPC z rule_id + from_sha + to_sha + relation. relation=supersedes
--        je zdroj projekce „platná verze" — driver mapper, klíč server-side.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; service_role / admin / staff.
-- Audit: li_links.upsert_completed s počty (bez PII).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.li_upsert_links(
  p_rows           jsonb,
  p_export_id      text DEFAULT NULL,
  p_engine_version text DEFAULT NULL,
  p_verify_ok      boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean := public.is_service_role();
  v_keyed      jsonb;
  v_batch      jsonb;
  v_total      integer;
  v_updated    integer;
  v_inserted   integer;
BEGIN
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a jsonb array';
  END IF;

  -- link_key = md5(rule_id | from_sha | to_sha | relation).
  SELECT COALESCE(jsonb_agg(
    item || jsonb_build_object('_link_key', md5(
      COALESCE(item->>'rule_id', '') || '|' ||
      COALESCE(item->'from'->>'source_sha256', '') || '|' ||
      COALESCE(item->'to'->>'source_sha256', '') || '|' ||
      COALESCE(item->>'relation', '')
    ))
  ), '[]'::jsonb) INTO v_keyed
  FROM jsonb_array_elements(p_rows) AS item
  WHERE item->'from'->>'source_sha256' IS NOT NULL
    AND item->'to'->>'source_sha256' IS NOT NULL;

  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON (item->>'_link_key') item
    FROM jsonb_array_elements(v_keyed) AS item
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.li_links l
  WHERE l.link_key IN (
    SELECT item->>'_link_key'
    FROM jsonb_array_elements(v_batch) AS item
  );

  INSERT INTO public.li_links (
    link_key, rule_id, relation,
    from_sha256, from_slug, from_doc_type,
    to_sha256, to_slug, to_doc_type, matched_by,
    export_id, engine_version, verify_ok, raw_data, ingested_at, updated_at
  )
  SELECT
    item->>'_link_key',
    item->>'rule_id',
    item->>'relation',
    item->'from'->>'source_sha256',
    item->'from'->>'source_slug',
    item->'from'->>'doc_type',
    item->'to'->>'source_sha256',
    item->'to'->>'source_slug',
    item->'to'->>'doc_type',
    COALESCE(item->'matched_by', '[]'::jsonb),
    p_export_id,
    p_engine_version,
    p_verify_ok,
    item - '_link_key',
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (link_key) DO UPDATE SET
    rule_id        = EXCLUDED.rule_id,
    relation       = EXCLUDED.relation,
    from_sha256    = EXCLUDED.from_sha256,
    from_slug      = EXCLUDED.from_slug,
    from_doc_type  = EXCLUDED.from_doc_type,
    to_sha256      = EXCLUDED.to_sha256,
    to_slug        = EXCLUDED.to_slug,
    to_doc_type    = EXCLUDED.to_doc_type,
    matched_by     = EXCLUDED.matched_by,
    export_id      = EXCLUDED.export_id,
    engine_version = EXCLUDED.engine_version,
    verify_ok      = EXCLUDED.verify_ok,
    raw_data       = EXCLUDED.raw_data,
    ingested_at    = EXCLUDED.ingested_at,
    updated_at     = now();

  v_inserted := v_total - v_updated;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'li_links.upsert_completed',
    jsonb_build_object(
      'export_id', p_export_id,
      'engine_version', p_engine_version,
      'verify_ok', p_verify_ok,
      'total', v_total,
      'inserted', v_inserted,
      'updated', v_updated
    )
  );

  RETURN jsonb_build_object(
    'total', v_total,
    'inserted', v_inserted,
    'updated', v_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.li_upsert_links(jsonb, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_upsert_links(jsonb, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_upsert_links(jsonb, text, text, boolean) TO service_role;

-- ============================================================================
-- Source of Truth: li_upsert_obligations
-- Popis: Batch upsert registru závazků z local-ingest. Volá svc-source-broker
--        li-driver z obligations_artifact.jsonl. obligation_key (dedup) počítá
--        RPC z source_sha256 + span + rule_id. candidate_status z importu je
--        VŽDY NEEDS_REVIEW — driver nikdy nezvyšuje na HUMAN_CONFIRMED (jen
--        review flow); RPC proto candidate_status z payloadu ignoruje a vynutí
--        NEEDS_REVIEW, a existující řádky nezreví-downgraduje.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; service_role / admin / staff.
-- Audit: li_obligations.upsert_completed s počty (bez PII).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.li_upsert_obligations(
  p_rows           jsonb,
  p_export_id      text DEFAULT NULL,
  p_engine_version text DEFAULT NULL,
  p_verify_ok      boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean := public.is_service_role();
  v_keyed      jsonb;
  v_batch      jsonb;
  v_total      integer;
  v_updated    integer;
  v_inserted   integer;
BEGIN
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a jsonb array';
  END IF;

  -- obligation_key = md5(source_sha256 | char_start | char_end | rule_id).
  -- Span v dokladu je unikátní; klíč je stabilní napříč exporty téhož dokladu.
  SELECT COALESCE(jsonb_agg(
    item || jsonb_build_object('_obligation_key', md5(
      COALESCE(item->>'source_sha256', '') || '|' ||
      COALESCE(item->'span'->>'char_start', '') || '|' ||
      COALESCE(item->'span'->>'char_end', '') || '|' ||
      COALESCE(item->>'rule_id', '')
    ))
  ), '[]'::jsonb) INTO v_keyed
  FROM jsonb_array_elements(p_rows) AS item
  WHERE item->>'source_sha256' IS NOT NULL
    AND item->>'quote' IS NOT NULL;

  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON (item->>'_obligation_key') item
    FROM jsonb_array_elements(v_keyed) AS item
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.li_obligations o
  WHERE o.obligation_key IN (
    SELECT item->>'_obligation_key'
    FROM jsonb_array_elements(v_batch) AS item
  );

  INSERT INTO public.li_obligations (
    obligation_key, source_sha256, doc_slug, filename, rule_id,
    clause_ref, clause_title, quote, char_start, char_end, page,
    obliged_party, action, deadline_text, consequence_text, candidate_status,
    export_id, engine_version, verify_ok, raw_data, ingested_at, updated_at
  )
  SELECT
    item->>'_obligation_key',
    item->>'source_sha256',
    item->>'source_slug',
    item->>'filename',
    item->>'rule_id',
    item->>'clause_ref',
    item->>'clause_title',
    item->>'quote',
    (item->'span'->>'char_start')::integer,
    (item->'span'->>'char_end')::integer,
    (item->'span'->>'page')::integer,
    item->>'obliged_party',
    item->>'action',
    item->>'deadline_text',
    item->>'consequence_text',
    'NEEDS_REVIEW',  -- vždy z importu; promoce jen přes review flow
    p_export_id,
    p_engine_version,
    p_verify_ok,
    item - '_obligation_key',
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (obligation_key) DO UPDATE SET
    source_sha256    = EXCLUDED.source_sha256,
    doc_slug         = EXCLUDED.doc_slug,
    filename         = EXCLUDED.filename,
    rule_id          = EXCLUDED.rule_id,
    clause_ref       = EXCLUDED.clause_ref,
    clause_title     = EXCLUDED.clause_title,
    quote            = EXCLUDED.quote,
    char_start       = EXCLUDED.char_start,
    char_end         = EXCLUDED.char_end,
    page             = EXCLUDED.page,
    obliged_party    = EXCLUDED.obliged_party,
    action           = EXCLUDED.action,
    deadline_text    = EXCLUDED.deadline_text,
    consequence_text = EXCLUDED.consequence_text,
    -- candidate_status se přes replay NIKDY nesnižuje: HUMAN_CONFIRMED z review
    -- flow přetrvá, i když re-export nese NEEDS_REVIEW (advisory ≠ pravda).
    export_id        = EXCLUDED.export_id,
    engine_version   = EXCLUDED.engine_version,
    verify_ok        = EXCLUDED.verify_ok,
    raw_data         = EXCLUDED.raw_data,
    ingested_at      = EXCLUDED.ingested_at,
    updated_at       = now();

  v_inserted := v_total - v_updated;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'li_obligations.upsert_completed',
    jsonb_build_object(
      'export_id', p_export_id,
      'engine_version', p_engine_version,
      'verify_ok', p_verify_ok,
      'total', v_total,
      'inserted', v_inserted,
      'updated', v_updated
    )
  );

  RETURN jsonb_build_object(
    'total', v_total,
    'inserted', v_inserted,
    'updated', v_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.li_upsert_obligations(jsonb, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_upsert_obligations(jsonb, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_upsert_obligations(jsonb, text, text, boolean) TO service_role;

-- ============================================================================
-- Source of Truth: li_upsert_entity_suggestions
-- Popis: Batch upsert advisory návrhů sjednocení entit z local-ingest. Volá
--        svc-source-broker li-driver z entity_suggestions_artifact.jsonl.
--        suggestion_key (dedup) počítá RPC. advisory zůstává vždy true (tabulka
--        má CHECK) — z těchto řádků se NIKDY negeneruje FK/vazba.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; service_role / admin / staff.
-- Audit: li_entity_suggestions.upsert_completed s počty (bez PII).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.li_upsert_entity_suggestions(
  p_rows           jsonb,
  p_export_id      text DEFAULT NULL,
  p_engine_version text DEFAULT NULL,
  p_verify_ok      boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean := public.is_service_role();
  v_keyed      jsonb;
  v_batch      jsonb;
  v_total      integer;
  v_updated    integer;
  v_inserted   integer;
BEGIN
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a jsonb array';
  END IF;

  -- suggestion_key = md5(suggestion | id_field/name_field | id_value/name_normalized).
  SELECT COALESCE(jsonb_agg(
    item || jsonb_build_object('_suggestion_key', md5(
      COALESCE(item->>'suggestion', '') || '|' ||
      COALESCE(item->>'id_field', item->>'name_field', '') || '|' ||
      COALESCE(item->>'id_value', item->>'name_normalized', '')
    ))
  ), '[]'::jsonb) INTO v_keyed
  FROM jsonb_array_elements(p_rows) AS item
  WHERE item->>'suggestion' IS NOT NULL;

  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON (item->>'_suggestion_key') item
    FROM jsonb_array_elements(v_keyed) AS item
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.li_entity_suggestions e
  WHERE e.suggestion_key IN (
    SELECT item->>'_suggestion_key'
    FROM jsonb_array_elements(v_batch) AS item
  );

  INSERT INTO public.li_entity_suggestions (
    suggestion_key, suggestion, id_field, id_value, name_field, name_normalized,
    names, ids, documents, advisory,
    export_id, engine_version, verify_ok, raw_data, ingested_at, updated_at
  )
  SELECT
    item->>'_suggestion_key',
    item->>'suggestion',
    item->>'id_field',
    item->>'id_value',
    item->>'name_field',
    item->>'name_normalized',
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(item->'names')), '{}'::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(item->'ids')), '{}'::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(item->'documents')), '{}'::text[]),
    true,  -- doktrína: advisory návrh, nikdy automatická vazba (tabulka má CHECK)
    p_export_id,
    p_engine_version,
    p_verify_ok,
    item - '_suggestion_key',
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (suggestion_key) DO UPDATE SET
    suggestion      = EXCLUDED.suggestion,
    id_field        = EXCLUDED.id_field,
    id_value        = EXCLUDED.id_value,
    name_field      = EXCLUDED.name_field,
    name_normalized = EXCLUDED.name_normalized,
    names           = EXCLUDED.names,
    ids             = EXCLUDED.ids,
    documents       = EXCLUDED.documents,
    export_id       = EXCLUDED.export_id,
    engine_version  = EXCLUDED.engine_version,
    verify_ok       = EXCLUDED.verify_ok,
    raw_data        = EXCLUDED.raw_data,
    ingested_at     = EXCLUDED.ingested_at,
    updated_at      = now();

  v_inserted := v_total - v_updated;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'li_entity_suggestions.upsert_completed',
    jsonb_build_object(
      'export_id', p_export_id,
      'engine_version', p_engine_version,
      'verify_ok', p_verify_ok,
      'total', v_total,
      'inserted', v_inserted,
      'updated', v_updated
    )
  );

  RETURN jsonb_build_object(
    'total', v_total,
    'inserted', v_inserted,
    'updated', v_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.li_upsert_entity_suggestions(jsonb, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_upsert_entity_suggestions(jsonb, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_upsert_entity_suggestions(jsonb, text, text, boolean) TO service_role;

-- Function: public.upsert_story_knowledge_item_audited
-- Description: Create or update a knowledge_items row scoped to a story.
--   When p_id is NULL → INSERT (new item). When p_id is provided →
--   UPDATE (must already belong to the story; cross-story moves are
--   rejected). Writes audit_journal on every mutation.
-- Security: SECURITY DEFINER. Admin/staff only (story participants can
--   READ via list_story_knowledge_items but writes need admin role —
--   keeps the KB curation surface narrow).

-- Brick4: the trailing p_locale param changes the arity (10 → 11). A new DEFAULT
-- arg does NOT replace the old overload (different arg count), so drop the 10-arg
-- signature first or callers face an ambiguous pair.
DROP FUNCTION IF EXISTS public.upsert_story_knowledge_item_audited(
  uuid, uuid, text, text, text, text, text, text[], text, text
);

CREATE OR REPLACE FUNCTION public.upsert_story_knowledge_item_audited(
  p_story_id        uuid,
  p_id              uuid DEFAULT NULL,
  p_title           text DEFAULT NULL,
  p_body_markdown   text DEFAULT NULL,
  p_item_type       text DEFAULT 'engineering_doc',
  p_summary         text DEFAULT NULL,
  p_category        text DEFAULT NULL,
  p_ai_context_tags text[] DEFAULT '{}'::text[],
  p_ai_instructions text DEFAULT NULL,
  p_visibility      text DEFAULT 'public',
  p_locale          text DEFAULT 'global'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id        uuid := auth.uid();
  v_item_id        uuid;
  v_existing_story_id uuid;
  v_existing_title text;
  v_existing_tags  text[];
  v_action         public.journal_action_type;
BEGIN
  IF v_user_id IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- service_role je důvěryhodná platformní role (přísnější než admin/staff) a je
  -- jediným writerem federovaných zdrojů (např. li-driver z local-ingest). Bez
  -- této větve is_admin_or_staff(NULL) padne na false a čistý service_role call
  -- se zamítne → KB zápisní cesta pro source-broker driver by byla mrtvá.
  IF NOT public.is_service_role() AND NOT public.is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Admin or staff role required to manage knowledge items'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.partner_stories WHERE id = p_story_id) THEN
    RAISE EXCEPTION 'Story not found: %', p_story_id USING ERRCODE = 'P0002';
  END IF;

  IF p_id IS NULL THEN
    -- INSERT path
    IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
      RAISE EXCEPTION 'Title is required for new knowledge items'
        USING ERRCODE = '22023';
    END IF;
    IF p_body_markdown IS NULL OR length(trim(p_body_markdown)) = 0 THEN
      RAISE EXCEPTION 'Body content is required for new knowledge items'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.knowledge_items (
      item_type, source_type, title, summary, body_markdown,
      ai_instructions, ai_context_tags, category, visibility,
      story_id, author_id, status, locale
    ) VALUES (
      p_item_type::public.knowledge_item_type,
      'manual',
      p_title,
      p_summary,
      p_body_markdown,
      p_ai_instructions,
      COALESCE(p_ai_context_tags, '{}'::text[]),
      p_category,
      p_visibility,
      p_story_id,
      v_user_id,
      'active',
      -- Brick4 locale axis: the caller's locale (defaults to the 'global' sentinel).
      -- COALESCE guards a NULL p_locale; the value must exist as a
      -- supported_languages(code) row (FK, no cascade) or the write fails 23503
      -- (fail-loud — never silently coerce an unsupported locale).
      COALESCE(p_locale, 'global')
    )
    RETURNING id INTO v_item_id;

    v_action := 'create'::public.journal_action_type;
  ELSE
    -- UPDATE path
    SELECT ki.story_id, ki.title, COALESCE(ki.ai_context_tags, '{}'::text[])
      INTO v_existing_story_id, v_existing_title, v_existing_tags
    FROM public.knowledge_items ki
    WHERE ki.id = p_id;

    IF v_existing_story_id IS NULL THEN
      RAISE EXCEPTION 'Knowledge item not found: %', p_id USING ERRCODE = 'P0002';
    END IF;

    IF v_existing_story_id <> p_story_id THEN
      RAISE EXCEPTION 'Knowledge item % belongs to a different story',
        p_id USING ERRCODE = '42501';
    END IF;

    UPDATE public.knowledge_items
       SET title             = COALESCE(p_title, title),
           summary           = COALESCE(p_summary, summary),
           body_markdown     = COALESCE(p_body_markdown, body_markdown),
           ai_instructions   = COALESCE(p_ai_instructions, ai_instructions),
           ai_context_tags   = COALESCE(p_ai_context_tags, ai_context_tags),
           category          = COALESCE(p_category, category),
           visibility        = COALESCE(p_visibility, visibility),
           item_type         = COALESCE(p_item_type::public.knowledge_item_type, item_type),
           -- Brick4: opt-in locale correction on update. Omitting p_locale keeps the
           -- item's existing locale (COALESCE no-op) — an item never silently changes
           -- language on a content edit.
           locale            = COALESCE(p_locale, locale),
           version           = version + 1,
           updated_at        = now()
     WHERE id = p_id
    RETURNING id INTO v_item_id;

    v_action := 'update'::public.journal_action_type;
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := v_action,
    p_area        := 'admin'::public.journal_area,
    p_details     := jsonb_build_object(
      'story_id', p_story_id,
      'item_type', p_item_type,
      'tag_count', COALESCE(array_length(p_ai_context_tags, 1), 0)
    ),
    p_entity_id   := v_item_id::text,
    p_entity_type := 'knowledge_items',
    p_new_values  := jsonb_strip_nulls(jsonb_build_object(
      'title', p_title,
      'tags', p_ai_context_tags,
      'category', p_category,
      'visibility', p_visibility
    )),
    p_old_values  := CASE
      WHEN p_id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'title', v_existing_title,
        'tags', v_existing_tags
      )
    END,
    p_severity    := 'info'::public.journal_severity,
    p_summary     := format(
      '%s knowledge_item for story %s',
      CASE WHEN p_id IS NULL THEN 'Created' ELSE 'Updated' END,
      p_story_id
    ),
    p_tags        := ARRAY['knowledge', 'story_kb'],
    p_user_id     := v_user_id
  );

  RETURN v_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_story_knowledge_item_audited(
  uuid, uuid, text, text, text, text, text, text[], text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_story_knowledge_item_audited(
  uuid, uuid, text, text, text, text, text, text[], text, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_story_knowledge_item_audited(
  uuid, uuid, text, text, text, text, text, text[], text, text, text
) TO service_role;

-- Audit
INSERT INTO public.audit_journal (user_id, action, metadata)
VALUES (
  NULL,
  'li_ingest_kb_writer.applied',
  jsonb_build_object(
    'migration', '20260715003814_li_ingest_kb_writer',
    'tables', jsonb_build_array(
      'li_source_registry', 'li_findings', 'li_links',
      'li_obligations', 'li_entity_suggestions'
    ),
    'rpcs', jsonb_build_array(
      'li_upsert_source_registry', 'li_upsert_findings', 'li_upsert_links',
      'li_upsert_obligations', 'li_upsert_entity_suggestions'
    ),
    'breaking_changes', false
  )
);
