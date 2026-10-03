import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";
import { HEADER, SERVICE_CLAIMS } from "./_e2e-spine";

/**
 * Governance write-path — admin-only gating (fail-closed) against a real DB.
 *
 * Both the rollback executor and the risk-policy CRUD mutate production config, so they gate on
 * is_admin_or_staff() — service_role alone is NOT sufficient. This test proves the gate fails closed
 * for a non-admin caller (even with a service_role claim): rollback → P0003, policy set → 42501.
 *
 * The happy paths (actual restore / policy upsert) require an admin user context + seeded fixtures;
 * those run on the dev stack with a real admin (see E2E_ORGANISM_BLUEPRINTS). Here we lock the gate.
 */

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("governance rollback + policy (admin gate)");
});

describe("governance write-path is admin-only (local DB)", () => {
  it.skipIf(!dbAvailable)("rollback + policy-set reject a non-admin caller (service_role insufficient)", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
DO $$
BEGIN
  ${SERVICE_CLAIMS}  -- service_role + random sub; is_admin_or_staff(sub) = false

  -- rollback executor is admin-only → P0003 (service_role is NOT enough)
  BEGIN
    PERFORM public.execute_improvement_proposal_rollback_admin(gen_random_uuid());
    RAISE EXCEPTION 'VIOLATION: rollback ran without admin';
  EXCEPTION
    WHEN SQLSTATE 'P0003' THEN NULL;  -- expected: Unauthorized
  END;

  -- risk-policy CRUD is admin-only → 42501
  BEGIN
    PERFORM public.set_ai_risk_policy_audited('low', 'high', 'critical');
    RAISE EXCEPTION 'VIOLATION: policy set ran without admin';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;  -- expected: Unauthorized (42501)
  END;
END $$;
`);
    expect(run).not.toThrow();
  });
});
