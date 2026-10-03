import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";
import { HEADER, SERVICE_CLAIMS } from "./_e2e-spine";

/**
 * create_mcp_token self-service (least-privilege) — the mint gate fails closed against a real DB.
 *
 * The story-scoped (9-arg) overload lets a non-admin authenticated user mint a PAT bound to THEIR OWN
 * identity (user_id = auth.uid()), but ONLY for a story they can access, and the unscoped (8-arg) form
 * stays admin-only. This locks the two security invariants that make self-service safe:
 *   1. NO scope escalation — minting for an inaccessible story → 42501.
 *   2. Unscoped tokens stay admin-only — a non-admin unscoped mint → 42501.
 *
 * The positive path (mint for an accessible / stack-default story → mcp_ token) needs a seeded story
 * + owner and runs on the dev stack (see E2E_ORGANISM_BLUEPRINTS); here we lock the gate.
 */

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("create_mcp_token self-service gate");
});

describe("create_mcp_token self-service is least-privilege (local DB)", () => {
  it.skipIf(!dbAvailable)("a non-admin cannot mint for an inaccessible story, nor an unscoped token", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
DO $$
BEGIN
  ${SERVICE_CLAIMS}  -- non-null auth.uid(), NOT admin/staff → the self-service path

  -- (1) scope escalation blocked: minting for a story the caller cannot access → 42501
  BEGIN
    PERFORM public.create_mcp_token(p_scope => 'story', p_scoped_to_story_id => gen_random_uuid());
    RAISE EXCEPTION 'VIOLATION: minted a token scoped to an inaccessible story';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;  -- expected: 42501
  END;

  -- (2) unscoped (8-arg) form stays admin-only for a non-admin → 42501
  BEGIN
    PERFORM public.create_mcp_token(p_scope => 'admin');
    RAISE EXCEPTION 'VIOLATION: non-admin minted an unscoped token';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;  -- expected: 42501
  END;
END $$;
`);
    expect(run).not.toThrow();
  });
});
