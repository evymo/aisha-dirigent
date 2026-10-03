import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Agent marketplace RUNTIME tests (Phase 2 — "up and running").
 *
 * Proves the call-mode runtime path: approving a declarative agent materializes
 * a routable agent_catalog row (+ rule bindings), route_task can route to it via
 * p_constraints.agent_slug, mcp_get_agent_knowledge surfaces its rules, and
 * disabling the plugin de-provisions it. Plus the system-agent collision guard
 * and get_agent_publish_detail least-privilege.
 *
 * Real-DB harness (throwaway pg17 via `npm run test:db`). RAISE → non-zero psql
 * exit → execFileSync throws → test fails.
 */

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("Agent Runtime RPC Runtime");
});

const HEADER = "\\set ON_ERROR_STOP on\n";

describe("Agent marketplace runtime (local DB)", () => {
  it.skipIf(!dbAvailable)(
    "approve materializes a routable agent; route_task routes to it; disable de-provisions",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_partner   record;
  v_rule_slug text;
  v_plugin_id uuid;
  v_queue_id  uuid;
  v_cat       record;
  v_bindings  int;
  v_route     jsonb;
  v_detail    jsonb;
BEGIN
  SELECT id, user_id INTO v_partner
    FROM public.partner_profiles WHERE certification_passed_at IS NOT NULL LIMIT 1;
  IF v_partner.id IS NULL THEN RAISE EXCEPTION 'fixture: no certified partner'; END IF;
  SELECT slug INTO v_rule_slug FROM public.expert_rules WHERE status = 'published' LIMIT 1;
  IF v_rule_slug IS NULL THEN RAISE EXCEPTION 'fixture: no published rule'; END IF;

  DELETE FROM public.agent_catalog  WHERE slug = 'zz-rt-agent';
  DELETE FROM public.plugin_catalog WHERE slug = 'zz-rt-agent';

  PERFORM set_config('request.jwt.claim.sub', v_partner.user_id::text, true);

  -- declarative agent with run-as-story template + runtime registry keys
  v_plugin_id := (public.submit_plugin(NULL, NULL, jsonb_build_object(
    'id', 'zz-rt-agent', 'version', '1.0.0', 'kind', 'agent',
    'name', 'ZZ Runtime Agent', 'description', 'runtime materialization test',
    'capabilities', jsonb_build_array('agent.run_as_story'),
    'lifecycle', jsonb_build_object('load_strategy', 'hot'),
    'agent_spec', jsonb_build_object(
      'rule_slugs', jsonb_build_array(v_rule_slug),
      'purpose', 'runtime test agent',
      'default_model', 'maxQuality',
      'allowed_tools', jsonb_build_array('search'),
      'safety_level', 'elevated',
      'autonomy_level', 'manual'
    )))->>'plugin_id')::uuid;

  PERFORM public.publish_agent(v_plugin_id);
  v_queue_id := (SELECT id FROM public.knowledge_moderation_queue
                  WHERE resource_id = v_plugin_id AND status = 'pending' LIMIT 1);

  -- approve → fn_aisha_kb_decision materializes the runtime atomically
  PERFORM public.fn_aisha_kb_decision(v_queue_id, 'approved');

  SELECT slug, source_plugin_id, is_active, default_model, safety_level, autonomy_level, purpose
    INTO v_cat FROM public.agent_catalog WHERE slug = 'zz-rt-agent';
  IF v_cat.slug IS NULL THEN RAISE EXCEPTION 'agent not materialized into agent_catalog'; END IF;
  IF v_cat.source_plugin_id IS DISTINCT FROM v_plugin_id THEN
    RAISE EXCEPTION 'source_plugin_id not set to %', v_plugin_id; END IF;
  IF NOT v_cat.is_active THEN RAISE EXCEPTION 'materialized agent not active'; END IF;
  IF v_cat.default_model <> 'maxQuality' THEN
    RAISE EXCEPTION 'default_model not projected: %', v_cat.default_model; END IF;
  IF v_cat.safety_level <> 'elevated' THEN RAISE EXCEPTION 'safety_level not projected'; END IF;
  IF v_cat.autonomy_level <> 'manual' THEN RAISE EXCEPTION 'autonomy_level not projected'; END IF;

  -- rule bindings created + surfaced by mcp_get_agent_knowledge (status fix)
  SELECT count(*) INTO v_bindings FROM public.agent_knowledge_bindings
    WHERE agent_slug = 'zz-rt-agent' AND story_id IS NULL AND is_active;
  IF v_bindings < 1 THEN RAISE EXCEPTION 'no rule bindings materialized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mcp_get_agent_knowledge('zz-rt-agent', 'rule')) THEN
    RAISE EXCEPTION 'mcp_get_agent_knowledge surfaced no rules (status filter)'; END IF;

  -- idempotent re-materialize
  PERFORM public.materialize_agent_runtime(v_plugin_id);
  IF (SELECT count(*) FROM public.agent_catalog WHERE slug = 'zz-rt-agent') <> 1 THEN
    RAISE EXCEPTION 'materialize not idempotent'; END IF;

  -- call-mode (pull): route_task routes the agent as PRIMARY via p_constraints.agent_slug,
  -- with a resolved model.
  v_route := public.route_task('chat', 'low', '{}'::text[], '{}'::text[], NULL,
                               jsonb_build_object('agent_slug', 'zz-rt-agent'));
  IF v_route->'agents'->0->>'slug' <> 'zz-rt-agent' THEN
    RAISE EXCEPTION 'agent is not the PRIMARY routed agent: %', v_route->'agents'; END IF;
  IF (v_route->'agents'->0->>'model') IS NULL OR (v_route->'agents'->0->>'model') = '' THEN
    RAISE EXCEPTION 'routed agent has no resolved model'; END IF;

  -- Platform risk governance still wraps an explicit marketplace agent — it is NOT
  -- above the rails. High risk → human approval + compliance required.
  v_route := public.route_task('chat', 'high', '{}'::text[], '{}'::text[], NULL,
                               jsonb_build_object('agent_slug', 'zz-rt-agent'));
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_route->'agents') a WHERE a->>'slug' = 'zz-rt-agent'
  ) THEN
    RAISE EXCEPTION 'explicit agent dropped under high risk: %', v_route->'agents'; END IF;
  IF (v_route->'stop_conditions'->>'require_human_approval') <> 'true' THEN
    RAISE EXCEPTION 'high-risk explicit agent did not require human approval'; END IF;
  IF (v_route->'stop_conditions'->>'must_pass_compliance') <> 'true' THEN
    RAISE EXCEPTION 'high-risk explicit agent did not require compliance'; END IF;

  -- get_agent_publish_detail returns full content
  v_detail := public.get_agent_publish_detail(v_plugin_id);
  IF v_detail->>'slug' <> 'zz-rt-agent' OR v_detail->'agent_spec' IS NULL THEN
    RAISE EXCEPTION 'get_agent_publish_detail bad payload: %', v_detail; END IF;

  -- de-provision: canary → disabled (kill-switch) deactivates the runtime
  PERFORM public.transition_plugin_status(jsonb_build_object('reason', 'test'), 'disabled', v_plugin_id);
  IF (SELECT is_active FROM public.agent_catalog WHERE slug = 'zz-rt-agent') THEN
    RAISE EXCEPTION 'agent_catalog not deactivated on disable'; END IF;
  -- route_task no longer routes to a disabled agent
  v_route := public.route_task('chat', 'low', '{}'::text[], '{}'::text[], NULL,
                               jsonb_build_object('agent_slug', 'zz-rt-agent'));
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_route->'agents') a WHERE a->>'slug' = 'zz-rt-agent'
  ) THEN
    RAISE EXCEPTION 'disabled agent is still routable'; END IF;

  DELETE FROM public.agent_catalog  WHERE slug = 'zz-rt-agent';
  DELETE FROM public.plugin_catalog WHERE slug = 'zz-rt-agent';
END $$;
`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)("materialize refuses to hijack a built-in system agent slug", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_partner   record;
  v_sys_slug  text;
  v_plugin_id uuid;
  v_queue_id  uuid;
  v_raised    boolean := false;
BEGIN
  SELECT id, user_id INTO v_partner
    FROM public.partner_profiles WHERE certification_passed_at IS NOT NULL LIMIT 1;
  -- a built-in seeded agent (source_plugin_id IS NULL)
  SELECT slug INTO v_sys_slug FROM public.agent_catalog WHERE source_plugin_id IS NULL LIMIT 1;
  IF v_sys_slug IS NULL THEN RAISE EXCEPTION 'fixture: no system agent seeded'; END IF;

  DELETE FROM public.plugin_catalog WHERE slug = v_sys_slug AND kind = 'agent';
  PERFORM set_config('request.jwt.claim.sub', v_partner.user_id::text, true);
  v_plugin_id := (public.submit_plugin(NULL, NULL, jsonb_build_object(
    'id', v_sys_slug, 'version', '1.0.0', 'kind', 'agent', 'name', 'Hijack Attempt',
    'capabilities', jsonb_build_array('agent.run_as_story'),
    'lifecycle', jsonb_build_object('load_strategy', 'hot'),
    'agent_spec', jsonb_build_object('rule_slugs', '[]'::jsonb)))->>'plugin_id')::uuid;
  PERFORM public.publish_agent(v_plugin_id);
  v_queue_id := (SELECT id FROM public.knowledge_moderation_queue
                  WHERE resource_id = v_plugin_id AND status = 'pending' LIMIT 1);

  BEGIN
    PERFORM public.fn_aisha_kb_decision(v_queue_id, 'approved');  -- triggers materialize → must raise
  EXCEPTION WHEN OTHERS THEN v_raised := true;
  END;

  -- the system agent row must be untouched (still source_plugin_id NULL)
  IF EXISTS (SELECT 1 FROM public.agent_catalog WHERE slug = v_sys_slug AND source_plugin_id IS NOT NULL) THEN
    RAISE EXCEPTION 'system agent slug % was hijacked', v_sys_slug; END IF;
  IF NOT v_raised THEN RAISE EXCEPTION 'expected materialize to refuse system slug collision'; END IF;

  DELETE FROM public.plugin_catalog WHERE id = v_plugin_id;
END $$;
`);
    expect(run).not.toThrow();
  });

  it.skipIf(!dbAvailable)("get_agent_publish_detail is service_role-only (no anon/authenticated)", () => {
    const grants = psqlQuery(`
SELECT
  has_function_privilege($$anon$$, $$public.get_agent_publish_detail(uuid)$$, $$EXECUTE$$),
  has_function_privilege($$authenticated$$, $$public.get_agent_publish_detail(uuid)$$, $$EXECUTE$$),
  has_function_privilege($$service_role$$, $$public.get_agent_publish_detail(uuid)$$, $$EXECUTE$$),
  has_function_privilege($$service_role$$, $$public.materialize_agent_runtime(uuid)$$, $$EXECUTE$$),
  has_function_privilege($$authenticated$$, $$public.materialize_agent_runtime(uuid)$$, $$EXECUTE$$)
`);
    const [detailAnon, detailAuth, detailSvc, matSvc, matAuth] = grants.split("|");
    expect(detailAnon).toBe("f");
    expect(detailAuth).toBe("f");
    expect(detailSvc).toBe("t");
    expect(matSvc).toBe("t");
    expect(matAuth).toBe("f"); // materialize is service-context only
  });

  it.skipIf(!dbAvailable)(
    "canary→ga stays materialized; canary→disabled hides rule bindings; disable is a no-op for unknown plugins",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_partner   record;
  v_rule_slug text;
  v_ga_id     uuid;
  v_dis_id    uuid;
  v_q         uuid;
  v_active    boolean;
  v_mcp_after int;
  v_res       jsonb;
BEGIN
  SELECT id, user_id INTO v_partner
    FROM public.partner_profiles WHERE certification_passed_at IS NOT NULL LIMIT 1;
  SELECT slug INTO v_rule_slug FROM public.expert_rules WHERE status = 'published' LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_partner.user_id::text, true);

  -- ── agent A: canary → ga (NULL-role transition) keeps it active/materialized ──
  DELETE FROM public.agent_catalog WHERE slug = 'zz-ga-agent';
  DELETE FROM public.plugin_catalog WHERE slug = 'zz-ga-agent';
  v_ga_id := (public.submit_plugin(NULL, NULL, jsonb_build_object(
    'id', 'zz-ga-agent', 'version', '1.0.0', 'kind', 'agent', 'name', 'ZZ GA',
    'capabilities', jsonb_build_array('agent.run_as_story'),
    'lifecycle', jsonb_build_object('load_strategy', 'hot'),
    'agent_spec', jsonb_build_object('rule_slugs', jsonb_build_array(v_rule_slug))))->>'plugin_id')::uuid;
  PERFORM public.publish_agent(v_ga_id);
  v_q := (SELECT id FROM public.knowledge_moderation_queue WHERE resource_id = v_ga_id AND status = 'pending' LIMIT 1);
  PERFORM public.fn_aisha_kb_decision(v_q, 'approved');  -- → canary + materialize
  PERFORM public.transition_plugin_status(jsonb_build_object('reason', 'promote'), 'ga', v_ga_id);
  SELECT is_active INTO v_active FROM public.agent_catalog WHERE slug = 'zz-ga-agent';
  IF NOT v_active THEN RAISE EXCEPTION 'canary→ga deactivated the agent'; END IF;

  -- ── agent B: canary → disabled deactivates the binding → mcp hides the rule ──
  DELETE FROM public.agent_catalog WHERE slug = 'zz-dis-agent';
  DELETE FROM public.plugin_catalog WHERE slug = 'zz-dis-agent';
  v_dis_id := (public.submit_plugin(NULL, NULL, jsonb_build_object(
    'id', 'zz-dis-agent', 'version', '1.0.0', 'kind', 'agent', 'name', 'ZZ Dis',
    'capabilities', jsonb_build_array('agent.run_as_story'),
    'lifecycle', jsonb_build_object('load_strategy', 'hot'),
    'agent_spec', jsonb_build_object('rule_slugs', jsonb_build_array(v_rule_slug))))->>'plugin_id')::uuid;
  PERFORM public.publish_agent(v_dis_id);
  v_q := (SELECT id FROM public.knowledge_moderation_queue WHERE resource_id = v_dis_id AND status = 'pending' LIMIT 1);
  PERFORM public.fn_aisha_kb_decision(v_q, 'approved');
  IF NOT EXISTS (SELECT 1 FROM public.mcp_get_agent_knowledge('zz-dis-agent', 'rule')) THEN
    RAISE EXCEPTION 'rule not surfaced after materialize'; END IF;

  PERFORM public.transition_plugin_status(jsonb_build_object('reason', 'kill'), 'disabled', v_dis_id);
  SELECT count(*) INTO v_mcp_after FROM public.mcp_get_agent_knowledge('zz-dis-agent', 'rule');
  IF v_mcp_after <> 0 THEN
    RAISE EXCEPTION 'inactive bindings still surface via mcp (% rules)', v_mcp_after; END IF;

  -- ── disable_agent_runtime is a no-op for a plugin that was never materialized ──
  v_res := public.disable_agent_runtime(gen_random_uuid());
  IF (v_res->>'disabled')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'disable of an unknown plugin must be a no-op'; END IF;

  DELETE FROM public.agent_catalog  WHERE slug IN ('zz-ga-agent', 'zz-dis-agent');
  DELETE FROM public.plugin_catalog WHERE id IN (v_ga_id, v_dis_id);
END $$;
`);
      expect(run).not.toThrow();
    },
  );
});

/**
 * Regressions for the adversarial-review hardening pass (8 confirmed defects).
 * Each test fails on the pre-fix code and passes after. DB-backed (skipped
 * without a reachable Postgres); validated via `npm run test:db`.
 */
describe("Agent marketplace runtime — review-driven hardening regressions (local DB)", () => {
  it.skipIf(!dbAvailable)(
    "mcp_get_agent_knowledge admits the service_role caller (auth.uid() NULL) — the GRANT is not dead",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE v_partner record; v_rule text; v_pid uuid; v_q uuid; v_cnt int;
BEGIN
  SELECT id, user_id INTO v_partner FROM public.partner_profiles WHERE certification_passed_at IS NOT NULL LIMIT 1;
  SELECT slug INTO v_rule FROM public.expert_rules WHERE status='published' LIMIT 1;
  DELETE FROM public.agent_catalog  WHERE slug='zz-svc-agent';
  DELETE FROM public.plugin_catalog WHERE slug='zz-svc-agent';
  PERFORM set_config('request.jwt.claim.sub', v_partner.user_id::text, true);
  v_pid := (public.submit_plugin(NULL, NULL, jsonb_build_object(
    'id','zz-svc-agent','version','1.0.0','kind','agent','name','ZZ Svc',
    'capabilities', jsonb_build_array('agent.run_as_story'),
    'lifecycle', jsonb_build_object('load_strategy','hot'),
    'agent_spec', jsonb_build_object('rule_slugs', jsonb_build_array(v_rule))))->>'plugin_id')::uuid;
  PERFORM public.publish_agent(v_pid);
  v_q := (SELECT id FROM public.knowledge_moderation_queue WHERE resource_id=v_pid AND status='pending' LIMIT 1);
  PERFORM public.fn_aisha_kb_decision(v_q, 'approved');

  -- service_role context: clear the JWT sub (auth.uid() → NULL) and assume the role.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_cnt FROM public.mcp_get_agent_knowledge('zz-svc-agent', 'rule');
  RESET ROLE;
  IF v_cnt < 1 THEN
    RAISE EXCEPTION 'service_role saw % rule rows — the auth guard wrongly rejected it', v_cnt; END IF;

  DELETE FROM public.agent_catalog  WHERE slug='zz-svc-agent';
  DELETE FROM public.plugin_catalog WHERE id=v_pid;
END $$;
`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "mcp_get_agent_knowledge returns only GLOBAL bindings — per-story bindings never leak across callers",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE v_partner record; v_rule_g text; v_rule_s text; v_rule_s_id uuid;
        v_pid uuid; v_q uuid; v_story uuid; v_leaked int;
BEGIN
  SELECT id, user_id INTO v_partner FROM public.partner_profiles WHERE certification_passed_at IS NOT NULL LIMIT 1;
  SELECT slug INTO v_rule_g FROM public.expert_rules WHERE status='published' ORDER BY slug LIMIT 1;
  SELECT slug, id INTO v_rule_s, v_rule_s_id
    FROM public.expert_rules WHERE status='published' AND slug <> v_rule_g ORDER BY slug LIMIT 1;
  IF v_rule_s IS NULL THEN RAISE NOTICE 'need 2 published rules — skipping'; RETURN; END IF;
  DELETE FROM public.agent_knowledge_bindings WHERE agent_slug='zz-story-agent';
  DELETE FROM public.agent_catalog  WHERE slug='zz-story-agent';
  DELETE FROM public.plugin_catalog WHERE slug='zz-story-agent';
  PERFORM set_config('request.jwt.claim.sub', v_partner.user_id::text, true);
  v_pid := (public.submit_plugin(NULL, NULL, jsonb_build_object(
    'id','zz-story-agent','version','1.0.0','kind','agent','name','ZZ Story',
    'capabilities', jsonb_build_array('agent.run_as_story'),
    'lifecycle', jsonb_build_object('load_strategy','hot'),
    'agent_spec', jsonb_build_object('rule_slugs', jsonb_build_array(v_rule_g))))->>'plugin_id')::uuid;
  PERFORM public.publish_agent(v_pid);
  v_q := (SELECT id FROM public.knowledge_moderation_queue WHERE resource_id=v_pid AND status='pending' LIMIT 1);
  PERFORM public.fn_aisha_kb_decision(v_q, 'approved');  -- global binding for v_rule_g

  -- A consumer install yields a real partner_story; attach a STORY-SCOPED binding.
  -- Signature is (p_plugin_id, p_partner_id, p_title) — plugin first.
  v_story := (public.install_agent_as_story(v_pid, v_partner.id, 'ZZ Story Install')->>'story_id')::uuid;
  INSERT INTO public.agent_knowledge_bindings
    (agent_slug, knowledge_item_id, binding_type, priority, is_active, story_id, notes)
    VALUES ('zz-story-agent', v_rule_s_id, 'rule', 100, true, v_story, 'story-scoped');

  SELECT count(*) INTO v_leaked
    FROM public.mcp_get_agent_knowledge('zz-story-agent', 'rule') WHERE slug = v_rule_s;
  IF v_leaked <> 0 THEN
    RAISE EXCEPTION 'story-scoped binding leaked via mcp (% rows)', v_leaked; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mcp_get_agent_knowledge('zz-story-agent', 'rule') WHERE slug = v_rule_g) THEN
    RAISE EXCEPTION 'global binding missing from mcp output'; END IF;

  DELETE FROM public.agent_knowledge_bindings WHERE agent_slug='zz-story-agent';
  DELETE FROM public.agent_catalog WHERE slug='zz-story-agent';
END $$;
`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "a late 'approved' decision never resurrects a disabled agent (kill-switch holds)",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE v_partner record; v_rule text; v_pid uuid; v_q uuid; v_active boolean;
BEGIN
  SELECT id, user_id INTO v_partner FROM public.partner_profiles WHERE certification_passed_at IS NOT NULL LIMIT 1;
  SELECT slug INTO v_rule FROM public.expert_rules WHERE status='published' LIMIT 1;
  DELETE FROM public.agent_catalog  WHERE slug='zz-disres-agent';
  DELETE FROM public.plugin_catalog WHERE slug='zz-disres-agent';
  PERFORM set_config('request.jwt.claim.sub', v_partner.user_id::text, true);
  v_pid := (public.submit_plugin(NULL, NULL, jsonb_build_object(
    'id','zz-disres-agent','version','1.0.0','kind','agent','name','ZZ DisRes',
    'capabilities', jsonb_build_array('agent.run_as_story'),
    'lifecycle', jsonb_build_object('load_strategy','hot'),
    'agent_spec', jsonb_build_object('rule_slugs', jsonb_build_array(v_rule))))->>'plugin_id')::uuid;
  PERFORM public.publish_agent(v_pid);
  v_q := (SELECT id FROM public.knowledge_moderation_queue WHERE resource_id=v_pid AND status='pending' LIMIT 1);

  -- Simulate "was materialized, then operator-disabled": a deactivated catalog row
  -- we own, and the plugin parked in 'disabled' while an approval is still in flight.
  INSERT INTO public.agent_catalog (slug, display_name, purpose, default_model, is_active, source_plugin_id)
    VALUES ('zz-disres-agent', 'ZZ DisRes', 'kill-switch test', 'balanced', false, v_pid);
  UPDATE public.plugin_catalog SET status='disabled'::plugin_status WHERE id=v_pid;

  -- The delayed AISHA 'approved' lands on the still-pending queue item.
  PERFORM public.fn_aisha_kb_decision(v_q, 'approved');

  SELECT is_active INTO v_active FROM public.agent_catalog WHERE slug='zz-disres-agent';
  IF v_active THEN
    RAISE EXCEPTION 'late approve re-activated a disabled agent — kill-switch defeated'; END IF;
  IF (SELECT status FROM public.plugin_catalog WHERE id=v_pid) <> 'disabled' THEN
    RAISE EXCEPTION 'late approve promoted a disabled plugin'; END IF;

  DELETE FROM public.agent_catalog  WHERE slug='zz-disres-agent';
  DELETE FROM public.plugin_catalog WHERE id=v_pid;
END $$;
`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "route_task call-mode refuses a built-in/system agent slug (source_plugin_id NULL) — marketplace pull only",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE v_partner record; v_route jsonb; v_primary text;
BEGIN
  SELECT id, user_id INTO v_partner FROM public.partner_profiles WHERE certification_passed_at IS NOT NULL LIMIT 1;
  DELETE FROM public.agent_catalog WHERE slug='zz-sys-agent';
  -- a built-in/system agent has source_plugin_id NULL
  INSERT INTO public.agent_catalog (slug, display_name, purpose, default_model, is_active, source_plugin_id)
    VALUES ('zz-sys-agent', 'ZZ System', 'system-privileged agent', 'balanced', true, NULL);
  PERFORM set_config('request.jwt.claim.sub', v_partner.user_id::text, true);

  v_route := public.route_task('chat', 'low', '{}'::text[], '{}'::text[], NULL,
                               jsonb_build_object('agent_slug', 'zz-sys-agent'));
  v_primary := v_route->'agents'->0->>'slug';
  IF v_primary = 'zz-sys-agent' THEN
    RAISE EXCEPTION 'call-mode pull reached a SYSTEM agent (source_plugin_id NULL) — privilege scoping broken'; END IF;

  DELETE FROM public.agent_catalog WHERE slug='zz-sys-agent';
END $$;
`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "an ESCALATED agent is approvable by a human reviewer (review_moderation_item accepts 'escalated')",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE v_partner record; v_rule text; v_pid uuid; v_q uuid;
        v_had_admin boolean; v_status text; v_active boolean;
BEGIN
  SELECT id, user_id INTO v_partner FROM public.partner_profiles WHERE certification_passed_at IS NOT NULL LIMIT 1;
  SELECT slug INTO v_rule FROM public.expert_rules WHERE status='published' LIMIT 1;
  DELETE FROM public.agent_catalog  WHERE slug='zz-esc-agent';
  DELETE FROM public.plugin_catalog WHERE slug='zz-esc-agent';
  PERFORM set_config('request.jwt.claim.sub', v_partner.user_id::text, true);
  v_pid := (public.submit_plugin(NULL, NULL, jsonb_build_object(
    'id','zz-esc-agent','version','1.0.0','kind','agent','name','ZZ Esc',
    'capabilities', jsonb_build_array('agent.run_as_story'),
    'lifecycle', jsonb_build_object('load_strategy','hot'),
    'agent_spec', jsonb_build_object('rule_slugs', jsonb_build_array(v_rule))))->>'plugin_id')::uuid;
  PERFORM public.publish_agent(v_pid);
  v_q := (SELECT id FROM public.knowledge_moderation_queue WHERE resource_id=v_pid AND status='pending' LIMIT 1);

  -- AISHA escalates → queue 'escalated', plugin stays 'reviewing'.
  PERFORM public.fn_aisha_kb_decision(v_q, 'escalated');
  IF (SELECT status FROM public.knowledge_moderation_queue WHERE id=v_q) <> 'escalated' THEN
    RAISE EXCEPTION 'expected escalated queue state'; END IF;

  -- Human admin approves the escalated item — must NOT be blocked.
  v_had_admin := EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=v_partner.user_id AND role='admin');
  INSERT INTO public.user_roles (user_id, role) VALUES (v_partner.user_id, 'admin') ON CONFLICT DO NOTHING;
  PERFORM public.review_moderation_item('approved', 'human ok', v_q);
  IF NOT v_had_admin THEN DELETE FROM public.user_roles WHERE user_id=v_partner.user_id AND role='admin'; END IF;

  SELECT status INTO v_status FROM public.plugin_catalog WHERE id=v_pid;
  IF v_status <> 'canary' THEN RAISE EXCEPTION 'escalated agent not promoted (got %)', v_status; END IF;
  SELECT is_active INTO v_active FROM public.agent_catalog WHERE slug='zz-esc-agent';
  IF v_active IS NOT TRUE THEN RAISE EXCEPTION 'escalated agent not materialized after human approve'; END IF;

  DELETE FROM public.agent_catalog  WHERE slug='zz-esc-agent';
  DELETE FROM public.plugin_catalog WHERE id=v_pid;
END $$;
`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "re-materialization preserves an operator soft-disabled rule binding (no resurrection)",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE v_partner record; v_rule text; v_pid uuid; v_q uuid;
BEGIN
  SELECT id, user_id INTO v_partner FROM public.partner_profiles WHERE certification_passed_at IS NOT NULL LIMIT 1;
  SELECT slug INTO v_rule FROM public.expert_rules WHERE status='published' LIMIT 1;
  DELETE FROM public.agent_knowledge_bindings WHERE agent_slug='zz-soft-agent';
  DELETE FROM public.agent_catalog  WHERE slug='zz-soft-agent';
  DELETE FROM public.plugin_catalog WHERE slug='zz-soft-agent';
  PERFORM set_config('request.jwt.claim.sub', v_partner.user_id::text, true);
  v_pid := (public.submit_plugin(NULL, NULL, jsonb_build_object(
    'id','zz-soft-agent','version','1.0.0','kind','agent','name','ZZ Soft',
    'capabilities', jsonb_build_array('agent.run_as_story'),
    'lifecycle', jsonb_build_object('load_strategy','hot'),
    'agent_spec', jsonb_build_object('rule_slugs', jsonb_build_array(v_rule))))->>'plugin_id')::uuid;
  PERFORM public.publish_agent(v_pid);
  v_q := (SELECT id FROM public.knowledge_moderation_queue WHERE resource_id=v_pid AND status='pending' LIMIT 1);
  PERFORM public.fn_aisha_kb_decision(v_q, 'approved');  -- materialize → active global binding

  -- Operator soft-disables the binding, then a canary→ga re-materialization runs.
  UPDATE public.agent_knowledge_bindings
     SET is_active=false WHERE agent_slug='zz-soft-agent' AND story_id IS NULL;
  PERFORM public.materialize_agent_runtime(v_pid);  -- idempotent re-run

  IF EXISTS (SELECT 1 FROM public.agent_knowledge_bindings
              WHERE agent_slug='zz-soft-agent' AND story_id IS NULL AND is_active=true) THEN
    RAISE EXCEPTION 're-materialization resurrected a soft-disabled binding'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agent_knowledge_bindings
                  WHERE agent_slug='zz-soft-agent' AND story_id IS NULL AND is_active=false) THEN
    RAISE EXCEPTION 'soft-disabled binding was destroyed (history lost)'; END IF;

  DELETE FROM public.agent_knowledge_bindings WHERE agent_slug='zz-soft-agent';
  DELETE FROM public.agent_catalog  WHERE slug='zz-soft-agent';
  DELETE FROM public.plugin_catalog WHERE id=v_pid;
END $$;
`);
      expect(run).not.toThrow();
    },
  );
});
