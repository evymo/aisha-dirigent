-- pgTAP — reprice confirmation goes through the CANONICAL in-story gate
-- ============================================================================
-- Asserts the convergence: hub_propose_reprice stamps metadata.reprice.status=pending
-- on the story_entry; the operator confirms/rejects via respond_to_story_block_audited
-- (authorized by STORY OWNERSHIP, not a global role); a trigger reflects the stamp into
-- hub_reprice_proposal.status; apply then works; and a NON-owner is denied. Run via
-- with-throwaway-db -- psql.
-- ============================================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(7);


-- Base commerce currency: the commerce RPCs call commerce_base_currency() which
-- fail-closes if unset. Production gets this from seed/core/07_system_config.sql;
-- schema tests run against baseline-only, so seed it here (superuser, pre role-switch).
-- ⛔ NAMĚŘENO 2026-09-13: seed nese tentýž klíč (core/07_system_config.sql). DO NOTHING
-- by nad DB se seedem nechal SEEDOVOU hodnotu. Dnes je v seedu taky "CZK", ale ta shoda
-- není vlastnost testu: změna seedu by tiše změnila, co test nad DB se seedem měří,
-- a CI (bez seedu) by to neviděla.
-- DO UPDATE = fixture vyhrává v obou. Brána: pgtap-fixture-nekoliduje-se-seedem.gate.test.ts.
INSERT INTO public.system_config (key, value, description)
  VALUES ('commerce_base_currency', '"CZK"', 'test base currency (commerce)')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description;

-- fixtures: a story OWNER (a partner) + a stranger, and the supplier story they own.
-- The gate authorizes by story ownership: get_current_partner_id() = story.partner_id
-- (partner-mode). partner_id FKs partner_profiles, so the owner gets a real partner row.
SELECT set_config('test.owner', gen_random_uuid()::text, true);
SELECT set_config('test.partner', gen_random_uuid()::text, true);
SELECT set_config('test.stranger', gen_random_uuid()::text, true);
SELECT set_config('test.story', gen_random_uuid()::text, true);
INSERT INTO aisha_auth.users (id) VALUES (current_setting('test.owner')::uuid) ON CONFLICT DO NOTHING;
INSERT INTO public.partner_profiles (id, user_id, display_name, city)
  VALUES (current_setting('test.partner')::uuid, current_setting('test.owner')::uuid,
          'Reprice Gate Owner', 'Praha');
INSERT INTO public.partner_stories (id, partner_id, user_id, title, status, priority)
  VALUES (current_setting('test.story')::uuid, current_setting('test.partner')::uuid,
          current_setting('test.owner')::uuid,
          'Ceník dodavatele — reprice gate test', 'inbox', 'normal');

-- propose two proposals as the proactive connector (service_role)
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
DECLARE v_src uuid := '66666666-6666-4666-a666-666666666666'; v_o1 uuid; v_o2 uuid;
        v_p1 public.hub_reprice_proposal; v_p2 public.hub_reprice_proposal; v_story uuid;
BEGIN
  v_story := current_setting('test.story')::uuid;
  INSERT INTO public.hub_source (id, slug, kind, display_name)
    VALUES (v_src, 'gate-supplier', 'edi', 'Gate Supplier') ON CONFLICT (slug) DO NOTHING;
  v_o1 := public.hub_upsert_supplier_offer(jsonb_build_object('source_id', v_src,
    'supplier_sku', 'GATE-1', 'product_type', 'tyre', 'season', 'winter', 'price_buy', 800));
  v_o2 := public.hub_upsert_supplier_offer(jsonb_build_object('source_id', v_src,
    'supplier_sku', 'GATE-2', 'product_type', 'tyre', 'season', 'winter', 'price_buy', 800));
  v_p1 := public.hub_propose_reprice(v_o1, 'fx_change', '{"quantity":4}'::jsonb, v_story);
  v_p2 := public.hub_propose_reprice(v_o2, 'fx_change', '{"quantity":4}'::jsonb, v_story);
  PERFORM set_config('test.p1', v_p1.id::text, true);
  PERFORM set_config('test.p2', v_p2.id::text, true);
  PERFORM set_config('test.e1',
    (SELECT id::text FROM public.story_entries WHERE story_id = v_story
       AND (metadata->>'proposal_id') = v_p1.id::text), true);
  PERFORM set_config('test.e2',
    (SELECT id::text FROM public.story_entries WHERE story_id = v_story
       AND (metadata->>'proposal_id') = v_p2.id::text), true);
END $$;

SELECT is(
  (SELECT metadata->'reprice'->>'status' FROM public.story_entries WHERE id = current_setting('test.e1')::uuid),
  'pending', 'propose stamps metadata.reprice.status=pending on the entry');

-- the story OWNER confirms P1 + rejects P2 through the canonical gate (member-mode)
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);
SELECT lives_ok(
  format('SELECT public.respond_to_story_block_audited(%L, %L::jsonb, %L::uuid, %L::uuid)',
         'confirm_reprice', '{}', current_setting('test.e1'), current_setting('test.story')),
  'story owner can confirm a reprice through the canonical gate');
SELECT is(
  (SELECT metadata->'reprice'->>'status' FROM public.story_entries WHERE id = current_setting('test.e1')::uuid),
  'confirmed', 'the gate stamps metadata.reprice.status=confirmed on the entry');
SELECT is(
  (SELECT status FROM public.hub_reprice_proposal WHERE id = current_setting('test.p1')::uuid),
  'confirmed', 'the trigger reflects the stamp into hub_reprice_proposal.status');
SELECT is(
  (SELECT decided_by FROM public.hub_reprice_proposal WHERE id = current_setting('test.p1')::uuid),
  current_setting('test.owner')::uuid, 'decided_by is the operator who confirmed in the story');

SELECT public.respond_to_story_block_audited('reject_reprice', '{}'::jsonb,
  current_setting('test.e2')::uuid, current_setting('test.story')::uuid);
SELECT is(
  (SELECT status FROM public.hub_reprice_proposal WHERE id = current_setting('test.p2')::uuid),
  'rejected', 'reject_reprice moves the proposal to rejected');

-- a NON-owner (no story access) is denied by the gate
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.stranger'), 'role', 'authenticated')::text, true);
SELECT throws_ok(
  format('SELECT public.respond_to_story_block_audited(%L, %L::jsonb, %L::uuid, %L::uuid)',
         'confirm_reprice', '{}', current_setting('test.e1'), current_setting('test.story')),
  NULL, 'Unauthorized: Story access denied',
  'a non-owner cannot act on the reprice gate (story-ownership authz)');

SELECT * FROM finish();
ROLLBACK;
