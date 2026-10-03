import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * get_my_agents RPC runtime tests.
 *
 * get_my_agents is the partner-scoped READ side of submit_plugin/publish_agent:
 * a certified guild member's OWN agents in ANY lifecycle status (the consumer
 * reader get_available_plugins only returns canary/ga and omits agent_spec).
 * Mirrors get_my_contributed_rules.
 *
 * Asserted on a real DB via ON_ERROR_STOP psql scripts (a RAISE → non-zero exit
 * → execFileSync throws → test fails):
 *   1) the authoring partner sees their own agents across statuses, with
 *      agent_spec hydrated (so the edit form can repopulate);
 *   2) a different partner does NOT see them, and a non-partner sees nothing
 *      (ownership isolation — no cross-partner leak);
 *   3) least-privilege grants (authenticated + service_role, never anon).
 */

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("get_my_agents RPC Runtime");
});

const HEADER = "\\set ON_ERROR_STOP on\n";

describe("get_my_agents RPC runtime (local DB)", () => {
  it.skipIf(!dbAvailable)(
    "authoring partner sees own agents across statuses, with agent_spec",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_partner   record;
  v_draft_id  uuid;
  v_rev_id    uuid;
  v_mine      integer;
  v_draft_st  text;
  v_rev_st    text;
  v_spec_purpose text;
BEGIN
  SELECT id, user_id INTO v_partner
    FROM public.partner_profiles
   WHERE certification_passed_at IS NOT NULL
   LIMIT 1;
  IF v_partner.id IS NULL THEN
    RAISE EXCEPTION 'fixture missing: no seeded certified partner';
  END IF;

  -- idempotent cleanup
  DELETE FROM public.plugin_catalog WHERE slug IN ('zz-mine-draft', 'zz-mine-review');

  PERFORM set_config('request.jwt.claim.sub', v_partner.user_id::text, true);

  -- one stays 'submitted', one is published → 'reviewing'
  v_draft_id := (public.submit_plugin(NULL, NULL, jsonb_build_object(
    'id', 'zz-mine-draft', 'version', '1.0.0', 'kind', 'agent',
    'name', 'ZZ Mine Draft', 'description', 'draft agent',
    'capabilities', jsonb_build_array('agent.run_as_story'),
    'lifecycle', jsonb_build_object('load_strategy', 'hot'),
    'agent_spec', jsonb_build_object('purpose', 'draft purpose', 'knowledge_items', '[]'::jsonb)
  ))->>'plugin_id')::uuid;

  v_rev_id := (public.submit_plugin(NULL, NULL, jsonb_build_object(
    'id', 'zz-mine-review', 'version', '2.0.0', 'kind', 'agent',
    'name', 'ZZ Mine Review', 'description', 'review agent',
    'capabilities', jsonb_build_array('agent.run_as_story'),
    'lifecycle', jsonb_build_object('load_strategy', 'hot'),
    'agent_spec', jsonb_build_object('purpose', 'review purpose', 'knowledge_items', '[]'::jsonb)
  ))->>'plugin_id')::uuid;
  PERFORM public.publish_agent(v_rev_id);

  -- get_my_agents returns BOTH (any status), and only the caller's own
  SELECT count(*) INTO v_mine
    FROM public.get_my_agents()
   WHERE slug IN ('zz-mine-draft', 'zz-mine-review');
  IF v_mine <> 2 THEN
    RAISE EXCEPTION 'expected both own agents returned, got %', v_mine;
  END IF;

  SELECT status INTO v_draft_st FROM public.get_my_agents() WHERE slug = 'zz-mine-draft';
  SELECT status INTO v_rev_st   FROM public.get_my_agents() WHERE slug = 'zz-mine-review';
  IF v_draft_st <> 'submitted' THEN
    RAISE EXCEPTION 'draft: expected submitted, got %', v_draft_st;
  END IF;
  IF v_rev_st <> 'reviewing' THEN
    RAISE EXCEPTION 'review: expected reviewing, got %', v_rev_st;
  END IF;

  -- agent_spec is hydrated (edit-form round-trip)
  SELECT agent_spec->>'purpose' INTO v_spec_purpose
    FROM public.get_my_agents() WHERE slug = 'zz-mine-draft';
  IF v_spec_purpose <> 'draft purpose' THEN
    RAISE EXCEPTION 'expected agent_spec.purpose returned, got %', v_spec_purpose;
  END IF;

  DELETE FROM public.plugin_catalog WHERE id IN (v_draft_id, v_rev_id);
END $$;
`);

      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "another partner and a non-partner do not see the caller's agents",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_partner   record;
  v_other     record;
  v_plugin_id uuid;
  v_leak      integer;
  v_random    uuid := gen_random_uuid();
BEGIN
  SELECT id, user_id INTO v_partner
    FROM public.partner_profiles WHERE certification_passed_at IS NOT NULL LIMIT 1;

  DELETE FROM public.plugin_catalog WHERE slug = 'zz-mine-iso';
  PERFORM set_config('request.jwt.claim.sub', v_partner.user_id::text, true);
  v_plugin_id := (public.submit_plugin(NULL, NULL, jsonb_build_object(
    'id', 'zz-mine-iso', 'version', '1.0.0', 'kind', 'agent',
    'name', 'ZZ Mine Iso',
    'capabilities', jsonb_build_array('agent.run_as_story'),
    'lifecycle', jsonb_build_object('load_strategy', 'hot'),
    'agent_spec', jsonb_build_object('knowledge_items', '[]'::jsonb)
  ))->>'plugin_id')::uuid;

  -- (a) a DIFFERENT partner must not see it
  SELECT id, user_id INTO v_other
    FROM public.partner_profiles WHERE id <> v_partner.id LIMIT 1;
  IF v_other.user_id IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_other.user_id::text, true);
    SELECT count(*) INTO v_leak FROM public.get_my_agents() WHERE slug = 'zz-mine-iso';
    IF v_leak <> 0 THEN
      RAISE EXCEPTION 'isolation: another partner saw % rows of the caller''s agent', v_leak;
    END IF;
  END IF;

  -- (b) a non-partner uuid sees nothing at all
  PERFORM set_config('request.jwt.claim.sub', v_random::text, true);
  SELECT count(*) INTO v_leak FROM public.get_my_agents();
  IF v_leak <> 0 THEN
    RAISE EXCEPTION 'isolation: non-partner saw % agents', v_leak;
  END IF;

  DELETE FROM public.plugin_catalog WHERE id = v_plugin_id;
END $$;
`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)("get_my_agents is least-privilege (authenticated + service_role, not anon)", () => {
    const grants = psqlQuery(`
SELECT
  has_function_privilege($$anon$$, $$public.get_my_agents()$$, $$EXECUTE$$),
  has_function_privilege($$authenticated$$, $$public.get_my_agents()$$, $$EXECUTE$$),
  has_function_privilege($$service_role$$, $$public.get_my_agents()$$, $$EXECUTE$$)
`);
    const [anon, authed, service] = grants.split("|");
    expect(anon).toBe("f");
    expect(authed).toBe("t");
    expect(service).toBe("t");
  });
});
