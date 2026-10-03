-- pgTAP schema-contract tests — hrany twinsverse s platností (osa B)
-- ============================================================================
-- Substrát, na kterém bude stát publikum, auditorium i elektorát. Proto se
-- netestuje „vrátí to řádky", ale vlastnosti, na kterých stojí odvozování:
--
--   · táž hrana nesmí platit dvakrát SOUČASNĚ (EXCLUDE) — ale navazovat
--     beze spáry smí, a souběh přes RŮZNÉ druhy je legitimní;
--   · uzavření není smazání: sjezd K DATU PŘED uzavřením hranu vidí,
--     PO něm ne — historie se neztrácí ani nepřepisuje;
--   · JEDEN ŘÁDEK NA UZEL i při více cestách — jinak agregace „vše pod
--     uzlem" započítá týž celek dvakrát;
--   · cyklus nesmí zacyklit sjezd a ořez o limit se HLÁSÍ (truncated);
--   · zápisová cesta audituje a guard drží.
--
-- ⚠️ DVĚ ODDĚLENÉ FIXTURY. A–D pro grafové vlastnosti, E–G pro omezení a
-- deduplikaci. Poprvé to byla jedna a `lives_ok` na souběh druhů přidalo hranu,
-- která posunula NÁSLEDUJÍCÍ počty — test padl na vlastní pořadí, ne na kódu.
-- Fixtura, která si mění vstup pod rukama, měří něco jiného, než tvrdí.
--
-- Vlastní entity_type ('pgtap_uzel'), takže suite nesáhne na skutečná data ani
-- proti obydlené databázi. Rolled back.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(17);

-- ── Identity ─────────────────────────────────────────────────────────────────
SELECT set_config('tr.admin', gen_random_uuid()::text, true);
SELECT set_config('tr.plain', gen_random_uuid()::text, true);

SET session_replication_role = replica;
INSERT INTO aisha_auth.users (id)
  VALUES (current_setting('tr.admin')::uuid), (current_setting('tr.plain')::uuid);
INSERT INTO user_roles (user_id, role)
  VALUES (current_setting('tr.admin')::uuid, 'admin');
SET session_replication_role = origin;

-- ── Fixtura I (A–D): grafové vlastnosti ──────────────────────────────────────
--   B —part_of→ A,  C —part_of→ B,  D —member_of→ A     (vše od 2026-01-01)
SELECT set_config('tr.a', gen_random_uuid()::text, true);
SELECT set_config('tr.b', gen_random_uuid()::text, true);
SELECT set_config('tr.c', gen_random_uuid()::text, true);
SELECT set_config('tr.d', gen_random_uuid()::text, true);
-- ── Fixtura II (E–G): omezení a deduplikace — ODDĚLENĚ, viz hlavička ─────────
SELECT set_config('tr.e', gen_random_uuid()::text, true);
SELECT set_config('tr.f', gen_random_uuid()::text, true);
SELECT set_config('tr.g', gen_random_uuid()::text, true);

INSERT INTO twin_entities (id, entity_type, label) VALUES
  (current_setting('tr.a')::uuid, 'pgtap_uzel', 'A'),
  (current_setting('tr.b')::uuid, 'pgtap_uzel', 'B'),
  (current_setting('tr.c')::uuid, 'pgtap_uzel', 'C'),
  (current_setting('tr.d')::uuid, 'pgtap_uzel', 'D'),
  (current_setting('tr.e')::uuid, 'pgtap_uzel', 'E'),
  (current_setting('tr.f')::uuid, 'pgtap_uzel', 'F'),
  (current_setting('tr.g')::uuid, 'pgtap_uzel', 'G');

-- pevná data → testy času jsou deterministické (žádné now())
INSERT INTO twin_relations (source_twin_id, target_twin_id, relation_kind, valid_from) VALUES
  (current_setting('tr.b')::uuid, current_setting('tr.a')::uuid, 'part_of',   '2026-01-01'),
  (current_setting('tr.c')::uuid, current_setting('tr.b')::uuid, 'part_of',   '2026-01-01'),
  (current_setting('tr.d')::uuid, current_setting('tr.a')::uuid, 'member_of', '2026-01-01'),
  -- F je pod E DVĚMA druhy, G pod F → ke G vedou DVĚ cesty
  (current_setting('tr.f')::uuid, current_setting('tr.e')::uuid, 'part_of',        '2026-01-01'),
  (current_setting('tr.f')::uuid, current_setting('tr.e')::uuid, 'responsible_for','2026-01-01'),
  (current_setting('tr.g')::uuid, current_setting('tr.f')::uuid, 'part_of',        '2026-01-01');

-- ── 1–4: tvar a omezení (fixtura II) ─────────────────────────────────────────
SELECT has_table('public', 'twin_relations', 'tabulka twin_relations existuje');

SELECT ok(
  EXISTS (SELECT 1 FROM twin_relations
           WHERE source_twin_id = current_setting('tr.f')::uuid
             AND target_twin_id = current_setting('tr.e')::uuid
             AND relation_kind = 'responsible_for'),
  'souběh RŮZNÝCH druhů vztahu nad touž dvojicí je legitimní');

SELECT throws_ok(
  format($q$ INSERT INTO twin_relations (source_twin_id, target_twin_id, relation_kind, valid_from)
         VALUES (%L, %L, 'part_of', '2026-03-01') $q$,
         current_setting('tr.f'), current_setting('tr.e')),
  '23P01', NULL,
  'táž hrana nesmí platit dvakrát současně (překryv otevřených intervalů)');

SELECT throws_ok(
  format($q$ INSERT INTO twin_relations (source_twin_id, target_twin_id, relation_kind)
         VALUES (%L, %L, 'part_of') $q$,
         current_setting('tr.e'), current_setting('tr.e')),
  '23514', NULL,
  'smyčka na sebe sama se odmítá');

-- ── 5: JEDEN ŘÁDEK NA UZEL i při více cestách ────────────────────────────────
-- Pod E vedou ke G dvě cesty (přes part_of i responsible_for) a F je dosažitelné
-- dvěma druhy. Surová rekurze by vrátila 4 řádky na 2 uzly — agregace by týž
-- celek započítala dvakrát. Naměřeno při zavádění, proto DISTINCT ON.
SELECT is(
  (SELECT count(*)::int FROM twin_graph_descendants(current_setting('tr.e')::uuid, NULL, '2026-02-01')),
  2, 'uzel dosažitelný VÍCE cestami se vrací JEDNOU (F, G — ne 4 řádky)');

SELECT is(
  (SELECT depth FROM twin_graph_descendants(current_setting('tr.e')::uuid, NULL, '2026-02-01')
    WHERE twin_id = current_setting('tr.f')::uuid),
  1, 'vyhrává NEJKRATŠÍ cesta');

-- ── 7–9: sjezd k datu (fixtura I) ────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM twin_graph_descendants(current_setting('tr.a')::uuid, NULL, '2026-02-01')),
  3, 'pod A jsou k 2026-02-01 tři uzly (B, C přes řetěz, D)');

SELECT is(
  (SELECT count(*)::int FROM twin_graph_descendants(current_setting('tr.a')::uuid, ARRAY['part_of'], '2026-02-01')),
  2, 'filtr druhů: part_of větev má dva uzly, member_of se nepočítá');

SELECT is(
  (SELECT depth FROM twin_graph_descendants(current_setting('tr.a')::uuid, ARRAY['part_of'], '2026-02-01')
    WHERE twin_id = current_setting('tr.c')::uuid),
  2, 'C je pod A v hloubce 2 (přes B)');

-- ── 10–12: uzavření není smazání ─────────────────────────────────────────────
UPDATE twin_relations SET valid_to = '2026-06-01'
 WHERE source_twin_id = current_setting('tr.b')::uuid
   AND target_twin_id = current_setting('tr.a')::uuid
   AND relation_kind = 'part_of';

SELECT is(
  (SELECT count(*)::int FROM twin_graph_descendants(current_setting('tr.a')::uuid, ARRAY['part_of'], '2026-02-01')),
  2, 'PŘED uzavřením (k 2026-02-01) hrana platí — historie zůstává');

SELECT is(
  (SELECT count(*)::int FROM twin_graph_descendants(current_setting('tr.a')::uuid, ARRAY['part_of'], '2026-07-01')),
  0, 'PO uzavření (k 2026-07-01) větev pod A zmizela — B i C s ní');

SELECT lives_ok(
  format($q$ INSERT INTO twin_relations (source_twin_id, target_twin_id, relation_kind, valid_from)
         VALUES (%L, %L, 'part_of', '2026-06-01') $q$,
         current_setting('tr.b'), current_setting('tr.a')),
  'navázání beze spáry: nová hrana smí začít přesně tam, kde stará skončila');

-- ── 13–14: cyklus a hlášený ořez ─────────────────────────────────────────────
INSERT INTO twin_relations (source_twin_id, target_twin_id, relation_kind, valid_from)
VALUES (current_setting('tr.a')::uuid, current_setting('tr.c')::uuid, 'part_of', '2026-01-01');

SELECT lives_ok(
  format($q$ SELECT count(*) FROM twin_graph_descendants(%L::uuid, ARRAY['part_of'], '2026-02-01') $q$,
         current_setting('tr.a')),
  'cyklus A→C→B→A sjezd nezacyklí');

SELECT is(
  (SELECT bool_or(truncated) FROM twin_graph_descendants(current_setting('tr.a')::uuid, ARRAY['part_of'], '2026-02-01', 1)),
  true, 'ořez o p_max_depth se HLÁSÍ (truncated) — tichý strop je zakázaný');

-- ── 15–16: zápisová cesta — guard a audit ────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('tr.plain'), 'role', 'authenticated')::text, true);
SELECT throws_ok(
  format($q$ SELECT twin_relation_open_admin(%L, %L, 'member_of') $q$,
         current_setting('tr.g'), current_setting('tr.e')),
  '42501', NULL,
  'non-admin hranu neotevře');

SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('tr.admin'), 'role', 'authenticated')::text, true);
SELECT lives_ok(
  format($q$ SELECT twin_relation_open_admin(%L, %L, 'member_of') $q$,
         current_setting('tr.g'), current_setting('tr.e')),
  'admin hranu otevře');

SELECT ok(
  EXISTS (SELECT 1 FROM audit_journal
           WHERE entity_type = 'twin_relation'
             AND created_at > now() - interval '1 minute'),
  'otevření hrany zapsalo auditní stopu — hrana bez důkazu je nárok bez důkazu');

SELECT * FROM finish();
ROLLBACK;
