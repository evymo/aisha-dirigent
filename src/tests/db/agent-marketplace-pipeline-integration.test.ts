import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Agent marketplace — END-TO-END PIPELINE integration test.
 *
 * One coherent narrative that maps the WHOLE flow as a system, against a real DB
 * (throwaway pg17), so we can see it works together — not just isolated RPCs:
 *
 *   1. PUBLISH   — certified guild member submits a declarative agent + requests review
 *   2. APPROVE   — the compliance decision (n8n callback / human) flips it canary AND
 *                  materializes the runtime atomically
 *   3. DISCOVER  — it lists for consumers + its rules surface for the runtime
 *   4. CALL-MODE — route_task routes to it (primary, model, platform risk governance)
 *   5. RUN-AS-STORY — a consumer installs it; compose_context (the realtime chat context)
 *                  loads the agent's rules into the system-prompt bundle
 *   6. KILL-SWITCH — an operator disables it → de-provisioned + no longer routable, WHILE
 *                  an already-installed consumer story keeps working (install survives)
 *
 * This is the integration proof that the runtime + governance layers compose.
 * (The HTTP/service layer — svc-ai-chat /router, /chat — is a thin pass-through to
 * route_task / compose_context, covered by the service unit tests; the n8n LLM
 * evaluation needs a live n8n+model and is exercised by the e2e stack.)
 */

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("Agent Marketplace Pipeline Integration");
});

const HEADER = "\\set ON_ERROR_STOP on\n";

describe("Agent marketplace end-to-end pipeline (local DB)", () => {
  it.skipIf(!dbAvailable)("publish → approve+materialize → discover → call-mode → run-as-story → kill-switch", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_partner   record;
  v_rule_slug text;
  v_plugin_id uuid;
  v_queue_id  uuid;
  v_status    text;
  v_cat       record;
  v_route     jsonb;
  v_inst      jsonb;
  v_story_id  uuid;
  v_bundle    jsonb;
  v_kb_before int;
  v_kb_after  int;
BEGIN
  -- ── fixtures ──
  SELECT id, user_id INTO v_partner
    FROM public.partner_profiles WHERE certification_passed_at IS NOT NULL LIMIT 1;
  IF v_partner.id IS NULL THEN RAISE EXCEPTION 'fixture: no certified partner'; END IF;
  SELECT slug INTO v_rule_slug FROM public.expert_rules WHERE status = 'published' LIMIT 1;
  IF v_rule_slug IS NULL THEN RAISE EXCEPTION 'fixture: no published rule'; END IF;

  DELETE FROM public.agent_catalog  WHERE slug = 'zz-pipe-agent';
  DELETE FROM public.partner_stories WHERE origin = 'agent_install' AND title = 'ZZ Pipe Agent';
  DELETE FROM public.plugin_catalog WHERE slug = 'zz-pipe-agent';

  -- ════ 1. PUBLISH (certified member) ════
  PERFORM set_config('request.jwt.claim.sub', v_partner.user_id::text, true);
  v_plugin_id := (public.submit_plugin(NULL, NULL, jsonb_build_object(
    'id', 'zz-pipe-agent', 'version', '1.0.0', 'kind', 'agent',
    'name', 'ZZ Pipe Agent', 'description', 'end-to-end pipeline agent',
    'capabilities', jsonb_build_array('agent.run_as_story'),
    'lifecycle', jsonb_build_object('load_strategy', 'hot'),
    'agent_spec', jsonb_build_object(
      'rule_slugs', jsonb_build_array(v_rule_slug),
      'knowledge_items', jsonb_build_array(
        jsonb_build_object('title', 'ZZ Pipe KB', 'body_markdown', 'agent knowledge body')),
      'purpose', 'pipeline test agent',
      'default_model', 'balanced'
    )))->>'plugin_id')::uuid;
  PERFORM public.publish_agent(v_plugin_id);
  v_queue_id := (SELECT id FROM public.knowledge_moderation_queue
                  WHERE resource_type = 'agent' AND resource_id = v_plugin_id AND status = 'pending' LIMIT 1);
  IF v_queue_id IS NULL THEN RAISE EXCEPTION '1. publish: no pending moderation item'; END IF;
  SELECT status INTO v_status FROM public.plugin_catalog WHERE id = v_plugin_id;
  IF v_status <> 'reviewing' THEN RAISE EXCEPTION '1. publish: expected reviewing, got %', v_status; END IF;

  -- ════ 2. APPROVE + MATERIALIZE (compliance decision) ════
  PERFORM public.fn_aisha_kb_decision(v_queue_id, 'approved');
  SELECT status INTO v_status FROM public.plugin_catalog WHERE id = v_plugin_id;
  IF v_status <> 'canary' THEN RAISE EXCEPTION '2. approve: expected canary, got %', v_status; END IF;
  SELECT slug, is_active, source_plugin_id, default_model INTO v_cat
    FROM public.agent_catalog WHERE slug = 'zz-pipe-agent';
  IF v_cat.slug IS NULL OR NOT v_cat.is_active OR v_cat.source_plugin_id IS DISTINCT FROM v_plugin_id THEN
    RAISE EXCEPTION '2. approve: runtime not materialized'; END IF;

  -- ════ 3. DISCOVER (listing + runtime knowledge) ════
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(public.get_available_plugins('agent', NULL)) e
     WHERE e->>'slug' = 'zz-pipe-agent'
  ) THEN RAISE EXCEPTION '3. discover: agent not listed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mcp_get_agent_knowledge('zz-pipe-agent', 'rule')) THEN
    RAISE EXCEPTION '3. discover: agent rules do not surface for the runtime'; END IF;

  -- ════ 4. CALL-MODE (consumer invokes the agent through the router) ════
  v_route := public.route_task('chat', 'low', '{}'::text[], '{}'::text[], NULL,
                               jsonb_build_object('agent_slug', 'zz-pipe-agent'));
  IF v_route->'agents'->0->>'slug' <> 'zz-pipe-agent' THEN
    RAISE EXCEPTION '4. call-mode: agent not primary in route plan: %', v_route->'agents'; END IF;
  IF (v_route->'agents'->0->>'model') IS NULL THEN
    RAISE EXCEPTION '4. call-mode: no model resolved'; END IF;

  -- ════ 5. RUN-AS-STORY (consumer installs + the realtime chat context loads its rules) ════
  v_inst := public.install_agent_as_story(v_plugin_id, v_partner.id, 'ZZ Pipe Agent');
  v_story_id := (v_inst->>'story_id')::uuid;
  IF v_story_id IS NULL THEN RAISE EXCEPTION '5. install: no story minted'; END IF;
  SELECT count(*) INTO v_kb_before FROM public.knowledge_items WHERE story_id = v_story_id;

  -- compose_context is exactly what svc-ai-chat injects into the system prompt per turn.
  v_bundle := public.compose_context(v_story_id, 'repo_plus_rules', NULL, NULL, NULL, v_partner.user_id);
  IF v_bundle IS NULL THEN RAISE EXCEPTION '5. run-as-story: compose_context returned null'; END IF;
  -- compose_context returns { layers: { ruleset: { rules: [...] }, ... }, ... }
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_bundle->'layers'->'ruleset'->'rules', '[]'::jsonb)) r
     WHERE r->>'slug' = v_rule_slug
  ) THEN
    RAISE EXCEPTION '5. run-as-story: agent rule % not loaded into the chat context bundle: %',
      v_rule_slug, v_bundle->'layers'->'ruleset'; END IF;

  -- ════ 6. KILL-SWITCH (operator disables; install survives) ════
  PERFORM public.transition_plugin_status(jsonb_build_object('reason', 'pipeline test'), 'disabled', v_plugin_id);
  IF (SELECT is_active FROM public.agent_catalog WHERE slug = 'zz-pipe-agent') THEN
    RAISE EXCEPTION '6. kill-switch: runtime not de-provisioned'; END IF;
  v_route := public.route_task('chat', 'low', '{}'::text[], '{}'::text[], NULL,
                               jsonb_build_object('agent_slug', 'zz-pipe-agent'));
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_route->'agents') a WHERE a->>'slug' = 'zz-pipe-agent') THEN
    RAISE EXCEPTION '6. kill-switch: disabled agent still routable'; END IF;
  -- the consumer's already-installed story is untouched (KB intact)
  SELECT count(*) INTO v_kb_after FROM public.knowledge_items WHERE story_id = v_story_id;
  IF v_kb_after <> v_kb_before OR v_kb_after < 1 THEN
    RAISE EXCEPTION '6. kill-switch: installed story KB was disturbed (% → %)', v_kb_before, v_kb_after; END IF;

  -- ── cleanup ──
  DELETE FROM public.partner_stories WHERE id = v_story_id;
  DELETE FROM public.agent_catalog  WHERE slug = 'zz-pipe-agent';
  DELETE FROM public.plugin_catalog WHERE id = v_plugin_id;
END $$;
`);
    expect(run).not.toThrow();
  });
});
