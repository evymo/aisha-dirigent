import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Plugin control-plane state machine — cold-start liveness + kill-switch.
 *
 * plugin_transition_rules rows previously lived only in an archived migration,
 * so on a fresh DB the table was empty and transition_plugin_status rejected
 * EVERY move ("Transition X → Y not allowed") — no operator could disable a live
 * (ga/canary) plugin. The core seed (27_plugin_transition_rules.sql) restores
 * the 15 rules. These tests assert the seed is present and the staff kill-switch
 * (ga → disabled) actually works — which matters now that the agent marketplace
 * publishes certified-member agents into ga/canary.
 */

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("plugin kill-switch runtime");
});

const HEADER = "\\set ON_ERROR_STOP on\n";

describe("plugin transition rules + kill-switch (local DB)", () => {
  it.skipIf(!dbAvailable)("transition rules are seeded on cold-start (15 rows)", () => {
    const count = psqlQuery("SELECT count(*) FROM public.plugin_transition_rules");
    expect(Number(count)).toBe(15);
  });

  it.skipIf(!dbAvailable)("staff can kill-switch a live (ga) agent → disabled", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_partner   record;
  v_plugin_id uuid;
  v_res       jsonb;
  v_status    text;
  v_had_admin boolean;
BEGIN
  SELECT id, user_id INTO v_partner
    FROM public.partner_profiles WHERE certification_passed_at IS NOT NULL LIMIT 1;

  DELETE FROM public.plugin_catalog WHERE slug = 'zz-test-killswitch';
  v_plugin_id := gen_random_uuid();
  INSERT INTO public.plugin_catalog (id, slug, name, kind, trust_tier, status, capabilities)
  VALUES (v_plugin_id, 'zz-test-killswitch', 'ZZ Kill Switch', 'agent', 'partner', 'ga', '[]'::jsonb);

  -- grant staff to the partner user just for this transition, then restore
  v_had_admin := EXISTS (SELECT 1 FROM public.user_roles
                          WHERE user_id = v_partner.user_id AND role = 'staff');
  INSERT INTO public.user_roles (user_id, role)
    VALUES (v_partner.user_id, 'staff') ON CONFLICT DO NOTHING;
  PERFORM set_config('request.jwt.claim.sub', v_partner.user_id::text, true);

  -- ga → disabled is the staff kill-switch; the seed must permit it
  v_res := public.transition_plugin_status(
    p_metadata := jsonb_build_object('reason', 'test kill-switch'),
    p_new_status := 'disabled',
    p_plugin_id := v_plugin_id
  );
  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'kill-switch failed: %', v_res->>'error';
  END IF;

  SELECT status INTO v_status FROM public.plugin_catalog WHERE id = v_plugin_id;
  IF v_status <> 'disabled' THEN
    RAISE EXCEPTION 'expected disabled after kill-switch, got %', v_status;
  END IF;

  IF NOT v_had_admin THEN
    DELETE FROM public.user_roles WHERE user_id = v_partner.user_id AND role = 'staff';
  END IF;
  DELETE FROM public.plugin_catalog WHERE id = v_plugin_id;
END $$;
`);
    expect(run).not.toThrow();
  });
});
