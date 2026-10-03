import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";
import { HEADER, SERVICE_CLAIMS } from "./_e2e-spine";

/**
 * T2 — Autonomy dial (governed auto-evaluation) against a real DB.
 *
 * Proves the EXISTING self-governance substrate behaves as designed:
 *  - get_autonomy_enforcement_rules(risk) is deterministic (low → auto_approve; critical → requires_approval).
 *  - The per-agent autonomy_level DIAL gates auto-approval: a low-risk proposal is 'auto_approved' for an
 *    agent at autonomy_level='full' but stays 'pending' for one at 'semi' — same proposal, different dial.
 *
 * Repeatable: unique slugs/anomaly_keys + FK-safe cleanup (proposals before agents).
 */

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("T2 autonomy dial");
});

describe("T2 — autonomy dial gates auto-approval (local DB)", () => {
  it.skipIf(!dbAvailable)("enforcement rules are deterministic and the dial flips auto-approve", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_sfx  text := substr(md5(random()::text), 1, 8);
  v_full text := 'e2e_agent_full_' || v_sfx;
  v_semi text := 'e2e_agent_semi_' || v_sfx;
  v_low  record;
  v_crit record;
  v_pf   jsonb;
  v_ps   jsonb;
BEGIN
  ${SERVICE_CLAIMS}

  -- (1) risk→enforcement is deterministic
  SELECT * INTO v_low  FROM public.get_autonomy_enforcement_rules('low');
  IF v_low.auto_approve  IS DISTINCT FROM true  OR v_low.requires_approval  IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'autonomy rules(low) wrong: %', row_to_json(v_low);
  END IF;
  SELECT * INTO v_crit FROM public.get_autonomy_enforcement_rules('critical');
  IF v_crit.auto_approve IS DISTINCT FROM false OR v_crit.requires_approval IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'autonomy rules(critical) wrong: %', row_to_json(v_crit);
  END IF;

  -- two agents differing ONLY in the autonomy dial
  INSERT INTO public.agent_catalog (slug, display_name, purpose, default_model, autonomy_level)
  VALUES (v_full, 'E2E Full', 'e2e', 'gpt-4o-mini', 'full'),
         (v_semi, 'E2E Semi', 'e2e', 'gpt-4o-mini', 'semi');

  -- (2) a LOW-risk proposal (category dashboard_rebuild → risk 'low') gates by the dial
  v_pf := public.fn_create_improvement_proposal(
    v_full, 'dashboard_rebuild', 'e2e', jsonb_build_object('anomaly_key', 'e2e_full_' || v_sfx), 'E2E full ' || v_sfx);
  v_ps := public.fn_create_improvement_proposal(
    v_semi, 'dashboard_rebuild', 'e2e', jsonb_build_object('anomaly_key', 'e2e_semi_' || v_sfx), 'E2E semi ' || v_sfx);

  IF v_pf->>'status' <> 'auto_approved' THEN
    RAISE EXCEPTION 'full+low must auto_approve, got %', v_pf;
  END IF;
  IF v_ps->>'status' <> 'pending' THEN
    RAISE EXCEPTION 'semi+low must stay pending, got %', v_ps;
  END IF;

  -- cleanup (FK: improvement_proposals.agent_slug → agent_catalog.slug → proposals first)
  DELETE FROM public.improvement_proposals WHERE id IN ((v_pf->>'proposal_id')::uuid, (v_ps->>'proposal_id')::uuid);
  DELETE FROM public.agent_catalog WHERE slug IN (v_full, v_semi);
END $$;
`);
    expect(run).not.toThrow();
  });
});
