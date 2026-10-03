import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("Partner Booking RPC Runtime");
});

const getOneCertifiedPartner = () => {
  const row = psqlQuery(
    "SELECT id, user_id FROM public.partner_profiles WHERE certification_passed_at IS NOT NULL LIMIT 1"
  );

  const [partnerId, ownerId] = row.split("|");
  if (!partnerId || !ownerId) {
    throw new Error("Missing seeded certified partner profile for runtime DB tests");
  }

  return { ownerId, partnerId };
};

describe("Partner booking RPC runtime (local DB)", () => {
  it.skipIf(!dbAvailable)("owner can execute get_partner_appointments without SQL runtime error", async () => {
    const { partnerId, ownerId } = getOneCertifiedPartner();

    psqlMultiline(`
DO $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '${ownerId}'::text, true);
  v_result := public.get_partner_appointments('${partnerId}'::uuid, NULL::date, false);

  IF jsonb_typeof(v_result) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Expected json array from get_partner_appointments';
  END IF;
END $$;
`);

    expect(true).toBe(true);
  });

  it.skipIf(!dbAvailable)("owner-only appointment RPC keeps anon blocked and authenticated allowed", async () => {
    const row = psqlQuery(`
SELECT
  has_function_privilege($$anon$$, $$public.get_partner_appointments(uuid,date,boolean)$$, $$EXECUTE$$),
  has_function_privilege($$authenticated$$, $$public.get_partner_appointments(uuid,date,boolean)$$, $$EXECUTE$$)
`);

    const [anonExec, authExec] = row.split("|");
    expect(anonExec).toBe("f");
    expect(authExec).toBe("t");
  });

  it.skipIf(!dbAvailable)("public booked slots RPC is callable and does not expose member identifiers", async () => {
    const { partnerId } = getOneCertifiedPartner();

    const grants = psqlQuery(`
SELECT
  has_function_privilege($$anon$$, $$public.get_public_partner_booked_slots(uuid,date)$$, $$EXECUTE$$),
  has_function_privilege($$authenticated$$, $$public.get_public_partner_booked_slots(uuid,date)$$, $$EXECUTE$$)
`);
    const [anonExec, authExec] = grants.split("|");
    expect(anonExec).toBe("t");
    expect(authExec).toBe("t");

    psqlMultiline(`
DO $$
DECLARE
  v_slots jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', ''::text, true);
  v_slots := public.get_public_partner_booked_slots('${partnerId}'::uuid, CURRENT_DATE);

  IF jsonb_typeof(v_slots) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Expected json array from get_public_partner_booked_slots';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_slots) AS slot
    WHERE slot ? 'member_id'
       OR slot ? 'member'
       OR slot ? 'notes'
  ) THEN
    RAISE EXCEPTION 'Public booked slots payload leaked sensitive data fields';
  END IF;
END $$;
`);

    expect(true).toBe(true);
  });
});
