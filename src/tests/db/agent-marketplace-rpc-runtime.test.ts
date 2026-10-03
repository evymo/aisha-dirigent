import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Agent marketplace RPC runtime tests (Phase 1).
 *
 * Exercises the full vertical slice on a real DB: a certified guild member
 * publishes a declarative agent (kind='agent', no code artifact), it goes
 * through the knowledge_moderation_queue spine, becomes listing-visible, and a
 * consumer installs it as their own story with story-scoped KB.
 *
 * Each scenario is a single ON_ERROR_STOP psql script that sets up its own
 * fixtures (reusing the seeded certified partner + a seeded published rule),
 * asserts via RAISE, and cleans up. A RAISE → non-zero psql exit → execFileSync
 * throws → the test fails. Negative cases bake the expectation into SQL
 * (catch the expected error; RAISE only if it did NOT occur).
 */

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("Agent Marketplace RPC Runtime");
});

const HEADER = "\\set ON_ERROR_STOP on\n";

describe("Agent marketplace RPC runtime (local DB)", () => {
  it.skipIf(!dbAvailable)(
    "certified partner publishes declarative agent → approve → list → install as story",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_partner   record;
  v_rule_slug text;
  v_manifest  jsonb;
  v_res       jsonb;
  v_plugin_id uuid;
  v_pub       jsonb;
  v_queue_id  uuid;
  v_status    text;
  v_list      jsonb;
  v_inst      jsonb;
  v_story_id  uuid;
  v_kb_story  uuid;
  v_kb_vis    text;
BEGIN
  SELECT id, user_id INTO v_partner
    FROM public.partner_profiles
   WHERE certification_passed_at IS NOT NULL
   LIMIT 1;
  IF v_partner.id IS NULL THEN
    RAISE EXCEPTION 'fixture missing: no seeded certified partner';
  END IF;

  SELECT slug INTO v_rule_slug
    FROM public.expert_rules WHERE status = 'published' LIMIT 1;
  IF v_rule_slug IS NULL THEN
    RAISE EXCEPTION 'fixture missing: no seeded published expert_rule';
  END IF;

  -- idempotent cleanup
  DELETE FROM public.partner_stories WHERE origin = 'agent_install'
     AND title = 'ZZ Test Agent Happy';
  DELETE FROM public.plugin_catalog WHERE slug = 'zz-test-agent-happy';

  -- act as the certified partner
  PERFORM set_config('request.jwt.claim.sub', v_partner.user_id::text, true);

  v_manifest := jsonb_build_object(
    'id', 'zz-test-agent-happy',
    'version', '1.0.0',
    'kind', 'agent',
    'name', 'ZZ Test Agent Happy',
    'description', 'A declarative test agent',
    'trust_tier', 'partner',
    'capabilities', jsonb_build_array('agent.run_as_story'),
    'lifecycle', jsonb_build_object('load_strategy', 'hot'),
    'agent_spec', jsonb_build_object(
      'rule_slugs', jsonb_build_array(v_rule_slug),
      'knowledge_items', jsonb_build_array(
        jsonb_build_object('title', 'ZZ KB One', 'body_markdown', 'agent kb body')
      ),
      'tech_stack', jsonb_build_array('node'),
      'risk_profile', 'low'
    )
  );

  -- 1) submit (declarative → no artifact, no version row)
  v_res := public.submit_plugin(NULL, NULL, v_manifest);
  v_plugin_id := (v_res->>'plugin_id')::uuid;
  IF v_res->>'status' <> 'submitted' THEN
    RAISE EXCEPTION 'submit: expected status submitted, got %', v_res->>'status';
  END IF;
  IF (v_res->>'version_id') IS NOT NULL THEN
    RAISE EXCEPTION 'submit: declarative agent must have null version_id';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.plugin_catalog
     WHERE id = v_plugin_id AND author_partner_id = v_partner.id
       AND trust_tier = 'partner' AND kind = 'agent'
  ) THEN
    RAISE EXCEPTION 'submit: agent not identity-bound to partner / wrong trust tier';
  END IF;

  -- 2) publish → moderation queue
  v_pub := public.publish_agent(v_plugin_id);
  v_queue_id := (v_pub->>'queue_id')::uuid;
  IF v_pub->>'status' <> 'review' THEN
    RAISE EXCEPTION 'publish: expected review, got %', v_pub->>'status';
  END IF;
  SELECT status INTO v_status FROM public.plugin_catalog WHERE id = v_plugin_id;
  IF v_status <> 'reviewing' THEN
    RAISE EXCEPTION 'publish: expected plugin reviewing, got %', v_status;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.knowledge_moderation_queue
     WHERE id = v_queue_id AND resource_type = 'agent'
       AND resource_id = v_plugin_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'publish: pending agent queue row missing';
  END IF;

  -- idempotent re-publish returns the same pending queue id
  IF (public.publish_agent(v_plugin_id)->>'queue_id')::uuid <> v_queue_id THEN
    RAISE EXCEPTION 'publish: re-publish should reuse the pending queue id';
  END IF;

  -- 3) approve via the decision callback (service path)
  PERFORM public.fn_aisha_kb_decision(v_queue_id, 'approved');
  SELECT status INTO v_status FROM public.plugin_catalog WHERE id = v_plugin_id;
  IF v_status <> 'canary' THEN
    RAISE EXCEPTION 'decision: expected canary after approve, got %', v_status;
  END IF;

  -- 4) listing surfaces the agent with name/description
  v_list := public.get_available_plugins('agent', NULL);
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_list) e
     WHERE e->>'slug' = 'zz-test-agent-happy'
       AND e->>'name' = 'ZZ Test Agent Happy'
       AND e->>'description' = 'A declarative test agent'
  ) THEN
    RAISE EXCEPTION 'listing: agent not visible with name/description';
  END IF;

  -- 5) install as a consumer-owned story (self-install: partner owns partner_id)
  v_inst := public.install_agent_as_story(v_plugin_id, v_partner.id, NULL);
  v_story_id := (v_inst->>'story_id')::uuid;
  IF (v_inst->>'kb_count')::int <> 1 THEN
    RAISE EXCEPTION 'install: expected kb_count 1, got %', v_inst->>'kb_count';
  END IF;
  IF (v_inst->>'rule_count')::int < 1 THEN
    RAISE EXCEPTION 'install: expected at least 1 resolved rule';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.partner_stories
     WHERE id = v_story_id AND user_id = v_partner.user_id
       AND origin = 'agent_install'
  ) THEN
    RAISE EXCEPTION 'install: story not minted with origin agent_install / wrong owner';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.story_rulesets WHERE story_id = v_story_id
  ) THEN
    RAISE EXCEPTION 'install: ruleset not created from rule_slugs';
  END IF;

  -- KB hydrated under the new story_id, story-scoped + private (isolation seam)
  SELECT story_id, visibility INTO v_kb_story, v_kb_vis
    FROM public.knowledge_items
   WHERE story_id = v_story_id AND source_type = 'agent_install'
   LIMIT 1;
  IF v_kb_story IS DISTINCT FROM v_story_id THEN
    RAISE EXCEPTION 'install: KB not scoped to the new story';
  END IF;
  IF v_kb_vis <> 'private' THEN
    RAISE EXCEPTION 'install: hydrated KB should be private, got %', v_kb_vis;
  END IF;

  -- cleanup
  DELETE FROM public.partner_stories WHERE id = v_story_id;
  DELETE FROM public.plugin_catalog WHERE id = v_plugin_id;
END $$;
`);

      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)("non-certified, non-admin caller cannot submit an agent", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_random uuid := gen_random_uuid();
  v_raised boolean := false;
BEGIN
  -- a uuid with no partner_profile and no admin role
  PERFORM set_config('request.jwt.claim.sub', v_random::text, true);
  BEGIN
    PERFORM public.submit_plugin(NULL, NULL, jsonb_build_object(
      'id', 'zz-test-agent-unauth', 'version', '1.0.0', 'kind', 'agent',
      'capabilities', jsonb_build_array('agent.run_as_story'),
      'lifecycle', jsonb_build_object('load_strategy', 'hot')
    ));
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    DELETE FROM public.plugin_catalog WHERE slug = 'zz-test-agent-unauth';
    RAISE EXCEPTION 'expected unauthorized submit to raise';
  END IF;
END $$;
`);
    expect(run).not.toThrow();
  });

  it.skipIf(!dbAvailable)("install enforces partner_id ownership and listing-visibility", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_partner   record;
  v_other     uuid;
  v_plugin_id uuid;
  v_raised    boolean;
BEGIN
  SELECT id, user_id INTO v_partner
    FROM public.partner_profiles WHERE certification_passed_at IS NOT NULL LIMIT 1;
  SELECT id INTO v_other
    FROM public.partner_profiles
   WHERE id <> v_partner.id LIMIT 1;

  DELETE FROM public.plugin_catalog WHERE slug = 'zz-test-agent-acl';
  PERFORM set_config('request.jwt.claim.sub', v_partner.user_id::text, true);
  v_plugin_id := (public.submit_plugin(NULL, NULL, jsonb_build_object(
    'id', 'zz-test-agent-acl', 'version', '1.0.0', 'kind', 'agent',
    'name', 'ZZ ACL Agent',
    'capabilities', jsonb_build_array('agent.run_as_story'),
    'lifecycle', jsonb_build_object('load_strategy', 'hot'),
    'agent_spec', jsonb_build_object('knowledge_items', '[]'::jsonb)
  ))->>'plugin_id')::uuid;

  -- (a) install before approval (status='submitted') must fail
  v_raised := false;
  BEGIN
    PERFORM public.install_agent_as_story(v_plugin_id, v_partner.id, NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'install: non-canary/ga agent should not be installable';
  END IF;

  -- approve it directly (admin/decision path) to make it installable
  PERFORM public.publish_agent(v_plugin_id);
  PERFORM public.fn_aisha_kb_decision(
    (SELECT id FROM public.knowledge_moderation_queue
      WHERE resource_id = v_plugin_id AND status = 'pending' LIMIT 1),
    'approved');

  -- (b) install with a partner_id the caller does NOT own must fail
  IF v_other IS NOT NULL THEN
    v_raised := false;
    BEGIN
      PERFORM public.install_agent_as_story(v_plugin_id, v_other, NULL);
    EXCEPTION WHEN OTHERS THEN v_raised := true; END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'install: must reject partner_id not owned by caller';
    END IF;
  END IF;

  DELETE FROM public.plugin_catalog WHERE id = v_plugin_id;
END $$;
`);
    expect(run).not.toThrow();
  });

  it.skipIf(!dbAvailable)("rejected agent returns to submitted; admin review approves to canary", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_partner   record;
  v_plugin_id uuid;
  v_queue_id  uuid;
  v_status    text;
  v_had_admin boolean;
BEGIN
  SELECT id, user_id INTO v_partner
    FROM public.partner_profiles WHERE certification_passed_at IS NOT NULL LIMIT 1;

  DELETE FROM public.plugin_catalog WHERE slug = 'zz-test-agent-review';
  PERFORM set_config('request.jwt.claim.sub', v_partner.user_id::text, true);
  v_plugin_id := (public.submit_plugin(NULL, NULL, jsonb_build_object(
    'id', 'zz-test-agent-review', 'version', '1.0.0', 'kind', 'agent',
    'name', 'ZZ Review Agent',
    'capabilities', jsonb_build_array('agent.run_as_story'),
    'lifecycle', jsonb_build_object('load_strategy', 'hot'),
    'agent_spec', jsonb_build_object('knowledge_items', '[]'::jsonb)
  ))->>'plugin_id')::uuid;

  -- reject path → back to submitted (resubmittable)
  PERFORM public.publish_agent(v_plugin_id);
  v_queue_id := (SELECT id FROM public.knowledge_moderation_queue
                  WHERE resource_id = v_plugin_id AND status = 'pending' LIMIT 1);
  PERFORM public.fn_aisha_kb_decision(v_queue_id, 'rejected');
  SELECT status INTO v_status FROM public.plugin_catalog WHERE id = v_plugin_id;
  IF v_status <> 'submitted' THEN
    RAISE EXCEPTION 'reject: expected submitted, got %', v_status;
  END IF;

  -- human admin review path: re-publish then approve via review_moderation_item
  PERFORM public.publish_agent(v_plugin_id);
  v_queue_id := (SELECT id FROM public.knowledge_moderation_queue
                  WHERE resource_id = v_plugin_id AND status = 'pending' LIMIT 1);

  -- grant admin to the partner's user just for this assertion, then revoke
  v_had_admin := EXISTS (SELECT 1 FROM public.user_roles
                          WHERE user_id = v_partner.user_id AND role = 'admin');
  INSERT INTO public.user_roles (user_id, role)
    VALUES (v_partner.user_id, 'admin') ON CONFLICT DO NOTHING;

  PERFORM public.review_moderation_item('approved', 'looks good', v_queue_id);
  SELECT status INTO v_status FROM public.plugin_catalog WHERE id = v_plugin_id;
  IF v_status <> 'canary' THEN
    RAISE EXCEPTION 'review: expected canary after admin approve, got %', v_status;
  END IF;

  IF NOT v_had_admin THEN
    DELETE FROM public.user_roles WHERE user_id = v_partner.user_id AND role = 'admin';
  END IF;
  DELETE FROM public.plugin_catalog WHERE id = v_plugin_id;
END $$;
`);
    expect(run).not.toThrow();
  });

  it.skipIf(!dbAvailable)("install_agent_as_story is least-privilege (authenticated only, not anon)", () => {
    const grants = psqlQuery(`
SELECT
  has_function_privilege($$anon$$, $$public.install_agent_as_story(uuid,uuid,text)$$, $$EXECUTE$$),
  has_function_privilege($$authenticated$$, $$public.install_agent_as_story(uuid,uuid,text)$$, $$EXECUTE$$),
  has_function_privilege($$anon$$, $$public.publish_agent(uuid)$$, $$EXECUTE$$),
  has_function_privilege($$authenticated$$, $$public.publish_agent(uuid)$$, $$EXECUTE$$)
`);
    const [instAnon, instAuth, pubAnon, pubAuth] = grants.split("|");
    expect(instAnon).toBe("f");
    expect(instAuth).toBe("t");
    expect(pubAnon).toBe("f");
    expect(pubAuth).toBe("t");
  });
});
