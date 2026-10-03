-- pgTAP schema-contract tests — story-sync runtime (bundle lifecycle end-to-end)
-- ============================================================================
-- One database plays both sides of the sync fence:
--   (1) origin story A: export_story_bundle → manifest schema_version 1.1.0,
--       expert_rules carry ai_instructions (fingerprint input since I2);
--   (2) the manifest is rewired to a fresh story UUID B (jsonb_set + rehash),
--       simulating a foreign instance: bootstrap_story_replica creates the
--       partner_stories row with the SAME UUID (origin='replica_sync'),
--       story_contexts and a NON-origin story_instances row. The knowledge
--       item slug is rewired too ('ki-sync-alpha-b') — the (source_slug,
--       locale) unique index is GLOBAL and story A already owns the original
--       slug in this single-DB setup. Expert rule slugs stay untouched on
--       purpose: rules are meant to slug-match across stories;
--   (3) import_story_bundle_from_manifest materializes expert_rules (slug
--       match — no duplicates), knowledge_items and a recomputed ruleset
--       fingerprint on the replica; a second import proves the shared-rule
--       guard: an UPDATE of a rule referenced by another story's ruleset is
--       skipped (skipped_shared_rules), a non-shared rule IS overwritten;
--   (4) adopt_story_as_stack_default: idempotent, singleton-guarded (second
--       default without demote → 22023), demote flag flips the singleton;
--   (5) promote_story_bundle from a non-origin instance lands 'pending';
--       approve materializes the promoted knowledge item on A, reject does not;
--   (6) negatives: manifest-hash mismatch aborts bootstrap, re-import at the
--       same bundle version is 'skipped', promote from the origin instance is
--       not authorized (validate_sync_authorization).
-- Runs UNSEEDED as superuser (RLS bypassed; function-internal guards proven
-- via request.jwt.claims). Rolled back — no COMMIT.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(31);

-- jsonb state holder for RPC results/manifests (dropped by the ROLLBACK)
CREATE TEMP TABLE _ss (k text PRIMARY KEY, v jsonb);

-- ── Identities ───────────────────────────────────────────────────────────────
SELECT set_config('ss.admin',   gen_random_uuid()::text, true);
SELECT set_config('ss.story_a', gen_random_uuid()::text, true);
SELECT set_config('ss.story_b', gen_random_uuid()::text, true);
SELECT set_config('ss.rule1',   gen_random_uuid()::text, true);
SELECT set_config('ss.rule2',   gen_random_uuid()::text, true);
SELECT set_config('ss.ruleset_a', gen_random_uuid()::text, true);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- Admin identity (is_admin_or_staff reads user_roles); FK/triggers off for the
-- unseeded aisha_auth insert only.
SET session_replication_role = replica;
INSERT INTO aisha_auth.users (id) VALUES (current_setting('ss.admin')::uuid);
INSERT INTO user_roles (user_id, role)
  VALUES (current_setting('ss.admin')::uuid, 'admin');
SET session_replication_role = origin;

-- The expert_rule → knowledge_items mirror trigger writes locale='global'
-- (FK → supported_languages); seed the sentinel (see 08_expert_rule_mirror.sql).
-- ⛔ NAMĚŘENO 2026-09-13: seed (core/02_languages.sql) nese tytéž kódy s jinými
-- hodnotami (cs/en is_default, name_native). DO NOTHING by nad DB se seedem nechal
-- SEEDOVÝ řádek a test by běžel nad jinými daty než v CI (bez seedu). DO UPDATE =
-- fixture vyhrává v obou. Brána: pgtap-fixture-nekoliduje-se-seedem.gate.test.ts.
INSERT INTO supported_languages (code, name_native, name_key, is_active, is_default, sort_order)
  VALUES ('global', 'Global', 'languages.global.name', true, false, 0)
  ON CONFLICT (code) DO UPDATE SET
    name_native = EXCLUDED.name_native, name_key = EXCLUDED.name_key,
    is_active = EXCLUDED.is_active, is_default = EXCLUDED.is_default, sort_order = EXCLUDED.sort_order;

-- Authenticate as admin for all RPC calls.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('ss.admin'), 'role', 'authenticated')::text, true);

-- Stack-default story jako fixtura (2026-09-30): trigger pravidel ji už nezakládá přes
-- ensure_stack_default_story(), kotva ai_runs ji jen VYHLEDÁ (viz 08_expert_rule_mirror.sql).
DO $$ BEGIN PERFORM public.ensure_stack_default_story(); END $$;

-- Origin story A + 2 published rules (with ai_instructions) + ruleset + context
-- + 1 active knowledge item.
INSERT INTO partner_stories (id, title)
  VALUES (current_setting('ss.story_a')::uuid, 'Sync origin story');

-- author_partner_id is NOT NULL but carries no FK (see 08_expert_rule_mirror.sql).
INSERT INTO expert_rules (id, slug, title, body_markdown, author_partner_id, status, version, ai_instructions)
  VALUES
    (current_setting('ss.rule1')::uuid, 'sync-rule-alpha', 'Sync Rule Alpha',
     'alpha body', gen_random_uuid(), 'published', 1, 'Prefer explicit column lists.'),
    (current_setting('ss.rule2')::uuid, 'sync-rule-beta', 'Sync Rule Beta',
     'beta body', gen_random_uuid(), 'published', 2, 'Guard nullability at the boundary.');

-- Fingerprint seeded with the canonical md5 formula (fn_recalculate_ruleset_fingerprint).
INSERT INTO story_rulesets (id, story_id, ruleset_fingerprint, rule_ids, rule_versions)
SELECT current_setting('ss.ruleset_a')::uuid,
       current_setting('ss.story_a')::uuid,
       md5(string_agg(er.slug || ':' || er.version::text || ':' || COALESCE(er.ai_instructions, ''),
                      '|' ORDER BY er.slug)),
       ARRAY[current_setting('ss.rule1')::uuid, current_setting('ss.rule2')::uuid],
       jsonb_build_object('sync-rule-alpha', 1, 'sync-rule-beta', 2)
FROM expert_rules er
WHERE er.id IN (current_setting('ss.rule1')::uuid, current_setting('ss.rule2')::uuid)
  AND er.status = 'published';

INSERT INTO story_contexts (story_id, ruleset_id)
  VALUES (current_setting('ss.story_a')::uuid, current_setting('ss.ruleset_a')::uuid);

INSERT INTO knowledge_items (item_type, source_type, source_slug, title, body_markdown, status, story_id)
  VALUES ('engineering_doc', 'manual', 'ki-sync-alpha', 'Sync KI Alpha',
          'ki body', 'active', current_setting('ss.story_a')::uuid);

-- Origin instance (export requires one) + default sync policies.
SELECT set_config('ss.inst_a_origin',
  (public.register_story_instance('a-origin', 'cloud', true, current_setting('ss.story_a')::uuid))->>'instance_id',
  true);
SELECT public.seed_default_sync_policies(current_setting('ss.story_a')::uuid);

-- ════════════════════════════════════════════════════════════════════════════
-- (1)–(3) EXPORT: manifest 1.1.0 with ai_instructions in expert_rules.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO _ss SELECT 'export_res',
  public.export_story_bundle(current_setting('ss.story_a')::uuid);
INSERT INTO _ss SELECT 'manifest_a', sb.portable_manifest
  FROM story_bundles sb
 WHERE sb.id = ((SELECT r.v->>'bundle_id' FROM _ss r WHERE r.k = 'export_res'))::uuid;

SELECT is(
  (SELECT v->>'schema_version' FROM _ss WHERE k = 'manifest_a'),
  '1.1.0', '(1) exported manifest carries schema_version 1.1.0');

SELECT is(
  (SELECT count(*)::int
     FROM jsonb_array_elements((SELECT v->'expert_rules' FROM _ss WHERE k = 'manifest_a')) r
    WHERE r ? 'ai_instructions'),
  2, '(2) every manifest expert rule carries the ai_instructions key');

SELECT is(
  (SELECT jsonb_array_length(v->'knowledge_items') FROM _ss WHERE k = 'manifest_a'),
  1, '(3) manifest packs the story''s active knowledge item');

-- ════════════════════════════════════════════════════════════════════════════
-- (4)–(8) BOOTSTRAP REPLICA: same UUID from manifest, origin='replica_sync'.
-- Simulate a foreign instance in the same DB: swap the story id, rehash.
-- ════════════════════════════════════════════════════════════════════════════
-- Rewire the story UUID AND the knowledge item slug: the (source_slug, locale)
-- unique index is GLOBAL, and story A already owns 'ki-sync-alpha' — without the
-- slug swap the import's cross-story guard would skip the materialization.
INSERT INTO _ss SELECT 'manifest_b',
  jsonb_set(
    jsonb_set(v, '{story_metadata,id}', to_jsonb(current_setting('ss.story_b'))),
    '{knowledge_items,0,slug}', to_jsonb('ki-sync-alpha-b'::text))
  FROM _ss WHERE k = 'manifest_a';
SELECT set_config('ss.hash_b',
  (SELECT encode(digest(v::text, 'sha256'), 'hex') FROM _ss WHERE k = 'manifest_b'), true);

INSERT INTO _ss SELECT 'boot_res',
  public.bootstrap_story_replica(v, current_setting('ss.hash_b'), 'replica-b', 'self-hosted')
  FROM _ss WHERE k = 'manifest_b';

SELECT is(
  (SELECT v->>'story_id' FROM _ss WHERE k = 'boot_res'),
  current_setting('ss.story_b'),
  '(4) bootstrap reuses the story UUID from the manifest');

SELECT is(
  (SELECT origin FROM partner_stories WHERE id = current_setting('ss.story_b')::uuid),
  'replica_sync', '(5) replica story row is created with origin=replica_sync');

SELECT is(
  (SELECT count(*)::int FROM story_contexts WHERE story_id = current_setting('ss.story_b')::uuid),
  1, '(6) replica story_contexts row exists');

SELECT is(
  (SELECT si.is_origin FROM story_instances si
    WHERE si.id = (SELECT (b.v->>'instance_id')::uuid FROM _ss b WHERE b.k = 'boot_res')),
  false, '(7) bootstrap registers a NON-origin instance for the replica');

SELECT ok(
  (SELECT (v->>'created_story')::boolean FROM _ss WHERE k = 'boot_res'),
  '(8) bootstrap reports created_story=true for a fresh replica');

-- ════════════════════════════════════════════════════════════════════════════
-- (9)–(13) IMPORT FROM MANIFEST: materialization on the replica.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO _ss SELECT 'import_res',
  public.import_story_bundle_from_manifest(
    m.v, 1, current_setting('ss.hash_b'), 'origin-lab', NULL,
    (SELECT (b.v->>'instance_id')::uuid FROM _ss b WHERE b.k = 'boot_res'))
  FROM _ss m WHERE m.k = 'manifest_b';

SELECT is(
  (SELECT v->>'status' FROM _ss WHERE k = 'import_res'),
  'success', '(9) manifest import succeeds');

SELECT ok(
  (SELECT (v ? 'materialized_rules') AND (v ? 'materialized_knowledge_items')
     FROM _ss WHERE k = 'import_res'),
  '(10) import reports materialized_rules + materialized_knowledge_items');

SELECT is(
  (SELECT count(*)::int FROM expert_rules WHERE slug IN ('sync-rule-alpha', 'sync-rule-beta')),
  2, '(11) expert rules are matched by slug — no duplicate rows after import');

SELECT is(
  (SELECT count(*)::int FROM knowledge_items
    WHERE story_id = current_setting('ss.story_b')::uuid AND status = 'active'),
  1, '(12) the replica story''s knowledge item is materialized');

SELECT is(
  (SELECT sr.ruleset_fingerprint
     FROM story_contexts sc JOIN story_rulesets sr ON sr.id = sc.ruleset_id
    WHERE sc.story_id = current_setting('ss.story_b')::uuid),
  (SELECT md5(string_agg(er.slug || ':' || er.version::text || ':' || COALESCE(er.ai_instructions, ''),
                         '|' ORDER BY er.slug))
     FROM story_contexts sc
     JOIN story_rulesets sr ON sr.id = sc.ruleset_id
     JOIN expert_rules er ON er.id = ANY(sr.rule_ids)
    WHERE sc.story_id = current_setting('ss.story_b')::uuid
      AND er.status = 'published'),
  '(13) replica ruleset fingerprint equals the canonical md5 recomputation');

-- ════════════════════════════════════════════════════════════════════════════
-- (14)–(17) SHARED-RULE GUARD: second import (bundle_version 2) tries to
-- overwrite 'sync-rule-alpha' (referenced by story A's ruleset → shared, the
-- UPDATE is skipped and counted as skipped_shared_rules) and the fresh
-- 'sync-rule-gamma-b' (referenced by no ruleset → overwritten). The skip
-- diverges the local fingerprint from the manifest one → outcome 'partial'.
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('ss.rule3', gen_random_uuid()::text, true);
INSERT INTO expert_rules (id, slug, title, body_markdown, author_partner_id, status, version, ai_instructions)
  VALUES (current_setting('ss.rule3')::uuid, 'sync-rule-gamma-b', 'Sync Rule Gamma B',
          'gamma body v1', gen_random_uuid(), 'published', 1, 'Keep gamma simple.');

-- manifest_b2 = manifest_b with alpha bumped to version 2 (rewritten by slug —
-- the manifest array order is not contractual) + gamma-b appended at version 2.
INSERT INTO _ss SELECT 'manifest_b2',
  jsonb_set(v, '{expert_rules}',
    (SELECT jsonb_agg(
       CASE WHEN e.value->>'slug' = 'sync-rule-alpha'
            THEN jsonb_set(e.value, '{version}', to_jsonb(2))
            ELSE e.value END)
       FROM jsonb_array_elements(v->'expert_rules') e)
    || jsonb_build_array(jsonb_build_object(
      'id', current_setting('ss.rule3'), 'slug', 'sync-rule-gamma-b',
      'title', 'Sync Rule Gamma B (v2)', 'category', 'other',
      'sub_category', NULL, 'content', 'gamma body v2',
      'ai_instructions', 'Keep gamma simple.', 'version', 2,
      'tags', jsonb_build_array())))
  FROM _ss WHERE k = 'manifest_b';
SELECT set_config('ss.hash_b2',
  (SELECT encode(digest(v::text, 'sha256'), 'hex') FROM _ss WHERE k = 'manifest_b2'), true);

INSERT INTO _ss SELECT 'import2_res',
  public.import_story_bundle_from_manifest(
    m.v, 2, current_setting('ss.hash_b2'), 'origin-lab', NULL,
    (SELECT (b.v->>'instance_id')::uuid FROM _ss b WHERE b.k = 'boot_res'))
  FROM _ss m WHERE m.k = 'manifest_b2';

SELECT is(
  (SELECT v->>'status' FROM _ss WHERE k = 'import2_res'),
  'partial',
  '(14) skipping a shared rule diverges the fingerprint — import outcome is partial');

SELECT is(
  (SELECT (so.metadata->>'skipped_shared_rules')::int FROM story_sync_operations so
    WHERE so.id = (SELECT (r.v->>'operation_id')::uuid FROM _ss r WHERE r.k = 'import2_res')),
  1, '(15) UPDATE of a rule shared by another story is skipped (skipped_shared_rules=1)');

SELECT is(
  (SELECT er.version FROM expert_rules er WHERE er.id = current_setting('ss.rule1')::uuid),
  1, '(16) shared rule sync-rule-alpha keeps its local version — never overwritten by import');

SELECT ok(
  (SELECT er.version = 2 FROM expert_rules er WHERE er.id = current_setting('ss.rule3')::uuid)
  AND (SELECT (v->>'updated_rules')::int = 1 FROM _ss WHERE k = 'import2_res'),
  '(17) non-shared rule sync-rule-gamma-b IS overwritten to version 2 (updated_rules=1)');

-- ════════════════════════════════════════════════════════════════════════════
-- (18)–(23) ADOPT AS STACK DEFAULT: idempotent singleton with demote handover.
-- ════════════════════════════════════════════════════════════════════════════
SELECT is(
  public.adopt_story_as_stack_default(current_setting('ss.story_a')::uuid, true),
  current_setting('ss.story_a')::uuid,
  '(18) adopting A (demoting any prior default) returns A');

SELECT is(
  public.adopt_story_as_stack_default(current_setting('ss.story_a')::uuid, false),
  current_setting('ss.story_a')::uuid,
  '(19) re-adopting the current default is idempotent');

SELECT is(
  (SELECT count(*)::int FROM partner_stories WHERE is_stack_default),
  1, '(20) exactly one stack-default story exists');

SELECT throws_ok(
  $q$SELECT public.adopt_story_as_stack_default(current_setting('ss.story_b')::uuid, false)$q$,
  '22023', NULL,
  '(21) adopting a second default without demote is rejected (22023)');

SELECT is(
  public.adopt_story_as_stack_default(current_setting('ss.story_b')::uuid, true),
  current_setting('ss.story_b')::uuid,
  '(22) demote flag hands the singleton over to B');

SELECT ok(
  (SELECT is_stack_default FROM partner_stories WHERE id = current_setting('ss.story_b')::uuid)
  AND NOT (SELECT is_stack_default FROM partner_stories WHERE id = current_setting('ss.story_a')::uuid),
  '(23) after handover B is default and A is demoted');

-- ════════════════════════════════════════════════════════════════════════════
-- (24)–(28) PROMOTE: non-origin instance of A proposes an extra knowledge item.
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('ss.inst_a2',
  (public.register_story_instance('a-workstation', 'self-hosted', false, current_setting('ss.story_a')::uuid))->>'instance_id',
  true);
INSERT INTO _ss SELECT 'tok_a2',
  public.generate_instance_auth_token(30, current_setting('ss.inst_a2')::uuid,
                                      '["sync:promote"]'::jsonb, 'promote-token');

INSERT INTO _ss SELECT 'manifest_p1',
  jsonb_set(v, '{knowledge_items}', (v->'knowledge_items') || jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'slug', 'ki-sync-promoted', 'title', 'Promoted insight',
    'content', 'learned downstream', 'category', 'notes', 'tags', jsonb_build_array(),
    'status', 'active', 'version', 1, 'verified', false, 'metadata', jsonb_build_object())))
  FROM _ss WHERE k = 'manifest_a';
SELECT set_config('ss.hash_p1',
  (SELECT encode(digest(v::text, 'sha256'), 'hex') FROM _ss WHERE k = 'manifest_p1'), true);

INSERT INTO _ss SELECT 'promote_res',
  public.promote_story_bundle(m.v, current_setting('ss.hash_p1'),
                              current_setting('ss.inst_a2')::uuid,
                              (SELECT t.v->>'token' FROM _ss t WHERE t.k = 'tok_a2'))
  FROM _ss m WHERE m.k = 'manifest_p1';

SELECT is(
  (SELECT v->>'status' FROM _ss WHERE k = 'promote_res'),
  'pending', '(24) promote lands as a pending operation');

INSERT INTO _ss SELECT 'approve_res',
  public.approve_story_promotion((SELECT (p.v->>'operation_id')::uuid FROM _ss p WHERE p.k = 'promote_res'));

SELECT is(
  (SELECT so.outcome::text FROM story_sync_operations so
    WHERE so.id = (SELECT (p.v->>'operation_id')::uuid FROM _ss p WHERE p.k = 'promote_res')),
  'success', '(25) approval marks the promote operation success');

SELECT is(
  (SELECT count(*)::int FROM knowledge_items
    WHERE story_id = current_setting('ss.story_a')::uuid AND status = 'active'),
  2, '(26) approved promotion materializes exactly the new knowledge item on A (slug-matched, no dup)');

-- Second promotion → rejected: nothing materializes.
INSERT INTO _ss SELECT 'manifest_p2',
  jsonb_set(v, '{knowledge_items}', (v->'knowledge_items') || jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'slug', 'ki-sync-rejected', 'title', 'Rejected insight',
    'content', 'off-canon claim', 'category', 'notes', 'tags', jsonb_build_array(),
    'status', 'active', 'version', 1, 'verified', false, 'metadata', jsonb_build_object())))
  FROM _ss WHERE k = 'manifest_a';
SELECT set_config('ss.hash_p2',
  (SELECT encode(digest(v::text, 'sha256'), 'hex') FROM _ss WHERE k = 'manifest_p2'), true);

INSERT INTO _ss SELECT 'promote2_res',
  public.promote_story_bundle(m.v, current_setting('ss.hash_p2'),
                              current_setting('ss.inst_a2')::uuid,
                              (SELECT t.v->>'token' FROM _ss t WHERE t.k = 'tok_a2'))
  FROM _ss m WHERE m.k = 'manifest_p2';

INSERT INTO _ss SELECT 'reject_res',
  public.reject_story_promotion(
    (SELECT (p.v->>'operation_id')::uuid FROM _ss p WHERE p.k = 'promote2_res'),
    'not aligned with canon');

SELECT is(
  (SELECT so.outcome::text FROM story_sync_operations so
    WHERE so.id = (SELECT (p.v->>'operation_id')::uuid FROM _ss p WHERE p.k = 'promote2_res')),
  'rejected', '(27) rejection marks the promote operation rejected');

SELECT is(
  (SELECT count(*)::int FROM knowledge_items
    WHERE story_id = current_setting('ss.story_a')::uuid AND status = 'active'),
  2, '(28) rejected promotion materializes nothing on A');

-- ════════════════════════════════════════════════════════════════════════════
-- (29)–(31) NEGATIVES: tamper, stale re-import, origin promote.
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('ss.story_c', gen_random_uuid()::text, true);
INSERT INTO _ss SELECT 'manifest_c',
  jsonb_set(v, '{story_metadata,id}', to_jsonb(current_setting('ss.story_c')))
  FROM _ss WHERE k = 'manifest_a';

SELECT throws_ok(
  $q$SELECT public.bootstrap_story_replica(
       (SELECT v FROM _ss WHERE k = 'manifest_c'), 'deadbeef', 'replica-c', 'self-hosted')$q$,
  '22023', NULL,
  '(29) manifest hash mismatch aborts bootstrap (22023)');

SELECT is(
  (public.import_story_bundle_from_manifest(
     (SELECT m.v FROM _ss m WHERE m.k = 'manifest_b'), 1, current_setting('ss.hash_b'),
     'origin-lab', NULL,
     (SELECT (b.v->>'instance_id')::uuid FROM _ss b WHERE b.k = 'boot_res')))->>'status',
  'skipped', '(30) re-import at an already-applied bundle version is skipped');

INSERT INTO _ss SELECT 'tok_origin',
  public.generate_instance_auth_token(30, current_setting('ss.inst_a_origin')::uuid,
                                      '["sync:promote"]'::jsonb, 'origin-promote');

SELECT is(
  (public.validate_sync_authorization(
     current_setting('ss.inst_a_origin')::uuid,
     (SELECT t.v->>'token' FROM _ss t WHERE t.k = 'tok_origin'),
     'promote', current_setting('ss.story_a')::uuid))->>'authorized',
  'false', '(31) promote from the origin instance is not authorized');

SELECT * FROM finish();
ROLLBACK;
