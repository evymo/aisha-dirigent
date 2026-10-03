-- pgTAP schema-contract tests — čerstvost bloku se bere Z DAT, ne z hodin serveru
-- ============================================================================
-- ⛔ NAMĚŘENO 2026-09-23 na produkci instance: faktury stály na exportu z 6. 8.,
-- ale bloky hlásily čerstvost „před chvílí" (`freshness_at` = now() v datové
-- větvi). Statická brána `cerstvost-z-dat` hlídá TVAR výrazu; tenhle test měří,
-- že přepsané funkce opravdu vracejí čas ze svých řádků:
--   · univerzum se STARÝMI daty → stará čerstvost (ne dnešek);
--   · prázdné univerzum → `trace_id` končí `:no_data`;
--   · `created_at`, NE `ingested_at` (ten přepisuje každý import — naměřeno
--     2026-09-27: 813 smluv = jediný čas).
--
-- Fixture: jména s předponou `pgtap-cerstvost`, runs UNSEEDED as superuser,
-- rolled back. Časy jsou pevné v minulosti, aby se nedaly splést s now().
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(13);

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ── 1) Prázdné univerzum → :no_data (ne tichá „čerstvost dneška") ───────────
SELECT is(
  (public.get_receivables_overdue('{}'::jsonb))->'provenance'->>'trace_id',
  'receivables-overdue:no_data',
  'pohledávky bez faktur: trace_id přizná :no_data'
);
SELECT is(
  (public.get_vedeni_aging('{}'::jsonb))->'provenance'->>'trace_id',
  'vedeni-aging:issued:no_data',
  'vedení bez dokladů: trace_id přizná :no_data'
);

-- ── Fixture: vydaná faktura po splatnosti, příchod verze 2026-08-06, import dnes ─
INSERT INTO public.li_source_registry
  (source_sha256, doc_slug, doc_type, filename, fields, line_items, created_at, ingested_at, updated_at)
VALUES
  (repeat('a', 64), 'pgtap-cerstvost-fa-1', 'invoice', 'pgtap-cerstvost-fa-1.json',
   jsonb_build_object(
     'document_subtype', jsonb_build_object('value', 'issued'),
     'counterparty',     jsonb_build_object('value', 'Odběratel pgTAP s.r.o.'),
     'counterparty_id',  jsonb_build_object('value', '00000001'),
     'owner_company',    jsonb_build_object('value', 'Firma pgTAP'),
     'amount_unpaid',    jsonb_build_object('value', '1210'),
     'due_date',         jsonb_build_object('value', '2026-07-15'),
     'issue_date',       jsonb_build_object('value', '2026-07-01')),
   jsonb_build_array(jsonb_build_object('fields', jsonb_build_object(
     'item_name',  jsonb_build_object('value', 'Nájem pgTAP'),
     'line_total', jsonb_build_object('value', '1000')))),
   timestamptz '2026-08-06 10:00:00+00', now(), now());

-- ── 2–3) Pohledávky: čerstvost = příchod verze, ne import ani volání ────────
SELECT is(
  (public.get_receivables_overdue('{}'::jsonb))->'provenance'->>'freshness_at',
  '2026-08-06T10:00:00Z',
  'pohledávky: čerstvost = created_at faktury (6. 8.), ne ingested_at ani now()'
);
SELECT is(
  (public.get_receivables_overdue('{}'::jsonb))->'provenance'->>'trace_id',
  'receivables-overdue',
  'pohledávky s daty: bez :no_data'
);

-- ── 4) Rozpad nájmu nad položkami téže faktury ──────────────────────────────
SELECT is(
  (public.get_rent_breakdown('{}'::jsonb))->'provenance'->>'freshness_at',
  '2026-08-06T10:00:00Z',
  'rozpad nájmu: čerstvost = created_at dokladu s položkami'
);

-- ── 5) Souhrn dokladů (metrika registered) ──────────────────────────────────
SELECT is(
  (public.get_document_digest('{"metric":"registered"}'::jsonb))->'provenance'->>'freshness_at',
  '2026-08-06T10:00:00Z',
  'souhrn dokladů: čerstvost = nejnovější created_at počítaného univerza'
);

-- ── 6–7) Detail dokladu: created_at, ne ingested_at; nenalezeno = odmítnutí ─
SELECT is(
  (public.get_document_detail('{"doc_slug":"pgtap-cerstvost-fa-1"}'::jsonb))->'provenance'->>'freshness_at',
  '2026-08-06T10:00:00Z',
  'detail dokladu: čerstvost = created_at (import dnes ji NEposune)'
);
SELECT is(
  (public.get_document_detail('{"doc_slug":"pgtap-cerstvost-neexistuje"}'::jsonb))->'provenance'->>'trace_id',
  'doc-detail:not_found',
  'detail neexistujícího dokladu: odmítací větev s důvodem :not_found'
);

-- ── Fixture: document_registry (vedení) — zdroj + neuhrazená faktura ────────
INSERT INTO public.agent_knowledge_sources (source_slug, namespace)
VALUES ('pgtap-cerstvost-zdroj', 'pgtap/cerstvost');
INSERT INTO public.document_registry
  (source_id, source_sha256, doc_type, doc_date, counterparty, sensitivity, metadata, created_at)
SELECT s.id, repeat('b', 64), 'invoice', date '2026-07-01', 'Odběratel pgTAP s.r.o.', 'internal',
       jsonb_build_object('direction', 'issued',
         'financial', jsonb_build_object('totalAmount', '1210', 'dueDate', '2026-07-15')),
       timestamptz '2026-08-06 11:00:00+00'
FROM public.agent_knowledge_sources s WHERE s.source_slug = 'pgtap-cerstvost-zdroj';

-- ── 8–9) Vedení nad document_registry ───────────────────────────────────────
SELECT is(
  (public.get_vedeni_aging('{}'::jsonb))->'provenance'->>'freshness_at',
  '2026-08-06T11:00:00Z',
  'vedení — stárnutí: čerstvost = created_at dokladu'
);
SELECT is(
  (public.get_vedeni_overdue('{}'::jsonb))->'provenance'->>'freshness_at',
  '2026-08-06T11:00:00Z',
  'vedení — po splatnosti: čerstvost = created_at dokladu'
);

-- ── 10–12) Nálezy vozového parku: čas ZE ZDROJE (occurred_at jízdy) ─────────
SELECT alike(
  (public.get_fleet_findings('{}'::jsonb))->'provenance'->>'trace_id',
  '%:no_data',
  'nálezy vozového parku bez jízd a překročení: :no_data'
);
INSERT INTO public.twin_entities (entity_type) VALUES ('pgtap-cerstvost-vozidlo');
INSERT INTO public.twin_events (event_type, twin_id, occurred_at, source, attrs)
SELECT 'trip', t.id, date_trunc('second', now()) - interval '2 days', 'pgtap-cerstvost', '{"distance_km":"5"}'::jsonb
FROM public.twin_entities t WHERE t.entity_type = 'pgtap-cerstvost-vozidlo';
SELECT is(
  (public.get_fleet_findings('{}'::jsonb))->'provenance'->>'freshness_at',
  to_char((date_trunc('second', now()) - interval '2 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'nálezy vozového parku: čerstvost = occurred_at poslední jízdy v okně (před 2 dny), ne dnešek'
);
SELECT is(
  (public.get_fleet_findings('{}'::jsonb))->'provenance'->>'trace_id',
  'fleet-findings',
  'nálezy vozového parku s jízdou: bez :no_data'
);

SELECT * FROM finish();
ROLLBACK;
