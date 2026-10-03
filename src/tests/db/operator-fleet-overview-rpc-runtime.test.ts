import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";
import { HEADER, SERVICE_CLAIMS } from "./_e2e-spine";

/**
 * fn_operator_fleet_overview (operator dashboard RPC) RUNTIME tests against a real DB.
 *
 * Proves the aggregation PLANS (every column/table reference resolves) and returns the expected
 * jsonb shape, and that it is fail-closed for an unauthenticated caller (42501).
 */

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("operator fleet overview");
});

describe("fn_operator_fleet_overview — operator snapshot (local DB)", () => {
  it.skipIf(!dbAvailable)("returns the expected snapshot shape as service_role", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
DO $$
DECLARE
  v jsonb;
BEGIN
  ${SERVICE_CLAIMS}
  v := public.fn_operator_fleet_overview(24);
  IF v IS NULL THEN RAISE EXCEPTION 'fleet overview returned NULL'; END IF;
  IF NOT (v ? 'runs_by_status' AND v ? 'decisions_by_runtime' AND v ? 'dispatch'
          AND v ? 'proposals_by_status' AND v ? 'reliability_rows' AND v ? 'window_hours') THEN
    RAISE EXCEPTION 'fleet overview missing keys: %', v;
  END IF;
  IF (v->>'window_hours')::int <> 24 THEN RAISE EXCEPTION 'window_hours wrong: %', v->>'window_hours'; END IF;
  IF NOT (v->'dispatch' ? 'avg_latency_ms') THEN RAISE EXCEPTION 'dispatch missing avg_latency_ms'; END IF;
END $$;
`);
    expect(run).not.toThrow();
  });

  it.skipIf(!dbAvailable)("is fail-closed: an unauthenticated caller cannot read the fleet", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);  -- no uid, no service_role
  BEGIN
    PERFORM public.fn_operator_fleet_overview(24);
    RAISE EXCEPTION 'VIOLATION: unauthenticated fleet read was allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;  -- 42501 expected
  END;
END $$;
`);
    expect(run).not.toThrow();
  });
});
