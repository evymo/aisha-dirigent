/**
 * RAG Isolation Security — per-story RBAC + quarantine filter (deny-tests)
 *
 * The mail/comms design requires that RAG retrieval be isolated by STORY permissions
 * (nobody retrieves vectors from a story they cannot access). An adversarial review of
 * the content pipeline found the isolation was NOT airtight — these tests lock the fixes:
 *
 *   #1 mcp_search_knowledge_v3 — p_story_id was a plain filter with NO RBAC; any
 *      authenticated user could read any story's chunks. Added a per-story RBAC guard
 *      (mirrors v2): non-service callers must be admin / owner / participant.
 *   #3 mcp_search_knowledge_v2 (story-scoped overload, called by compose_context) was
 *      MISSING the quarantine_status filter, so prompt-injection-flagged items stayed
 *      retrievable. Added the filter (the global overload already had it).
 *
 * Runs against a real PostgreSQL; skips cleanly without one. No fixtures needed —
 * a non-existent/unowned story is access-denied for any non-service caller, and the
 * function-definition checks are catalog reads.
 *
 * (Leak #2 — compose_context lacking a requester gate, exploitable via chat.ts — is a
 *  separate multi-file fix tracked alongside this one.)
 */

import { beforeAll, describe, expect, it } from "vitest";
import { psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

// Signatures track the SoT: v3 grew 13→15 args (Brick5 p_locale text +
// Brick6 p_audience_user_id uuid) and the story-scoped v2 grew 10→11
// (Brick6 p_audience_user_id uuid). The RBAC guard / quarantine filter
// asserted below are unchanged — this is a catalog-lookup signature refresh,
// not a behavior change.
const V3_SIG =
  "public.mcp_search_knowledge_v3(vector,halfvec,text,text[],text,text,text[],boolean,integer,numeric,uuid,text,text,text,uuid)";
const V2_STORY_SIG =
  "public.mcp_search_knowledge_v2(vector,text,text[],text,text,text[],boolean,integer,double precision,uuid,uuid)";

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("RAG Isolation Security");
});

describe("RAG isolation: per-story RBAC + quarantine filter", () => {
  it.skipIf(!dbAvailable)(
    "mcp_search_knowledge_v3 DENIES a non-service caller a story they do not own (no cross-tenant read)",
    () => {
      // A logged-in user (random sub) asking for a story they don't own is denied,
      // BEFORE the embedding-required check — proving the RBAC guard runs first.
      expect(() =>
        psqlQuery(
          `SELECT set_config('request.jwt.claim.sub', gen_random_uuid()::text, false); ` +
            `SET ROLE authenticated; ` +
            `SELECT public.mcp_search_knowledge_v3(NULL::vector, NULL::halfvec, NULL, NULL, NULL, NULL, NULL, true, 10, 0.3::numeric, gen_random_uuid(), 'v1')`,
        ),
      ).toThrow(/Access denied/i);
    },
  );

  it.skipIf(!dbAvailable)(
    "mcp_search_knowledge_v3 keys its RBAC bypass on the JWT role claim — bare SET ROLE service_role gets none",
    () => {
      // The v3 guard (aisha/db/sql/functions/mcp_search_knowledge_v3.sql) keys
      // its deliberate service-role bypass on get_jwt_role() — the JWT `role`
      // CLAIM — not on the session role. A bare `SET ROLE service_role` with no
      // service_role JWT claim therefore stays story-gated and is access-denied
      // for a story it has no membership in (the guard fires before the
      // embedding-required check). Defense in depth: identity comes from the
      // JWT, never from session state alone. A genuine internal caller (n8n,
      // compose_context) carries the service_role JWT claim and IS allowed by
      // design — that path is asserted in pgTAP 02_rag_isolation_rbac.sql (d).
      expect(() =>
        psqlQuery(
          `SET ROLE service_role; ` +
            `SELECT public.mcp_search_knowledge_v3(NULL::vector, NULL::halfvec, NULL, NULL, NULL, NULL, NULL, true, 10, 0.3::numeric, gen_random_uuid(), 'v1')`,
        ),
      ).toThrow(/Access denied/i);
    },
  );

  it.skipIf(!dbAvailable)(
    "the story-scoped mcp_search_knowledge_v2 overload filters flagged/quarantined items",
    () => {
      const def = psqlQuery(`SELECT pg_get_functiondef('${V2_STORY_SIG}'::regprocedure)`);
      expect(def).toContain("quarantine_status");
    },
  );

  it.skipIf(!dbAvailable)("mcp_search_knowledge_v3 carries the per-story RBAC guard", () => {
    const def = psqlQuery(`SELECT pg_get_functiondef('${V3_SIG}'::regprocedure)`);
    expect(def).toMatch(/Access denied to story/);
  });

  it.skipIf(!dbAvailable)(
    "compose_context fail-closes a story-scoped composition with NO requester (service-role bypass closed)",
    () => {
      // service_role + a story_id but no p_requester_id (and no auth.uid()) → refused
      // BEFORE composing anything. This is the fix for the LIVE chat-route leak.
      expect(() =>
        psqlQuery(
          `SET ROLE service_role; ` +
            `SELECT public.compose_context(gen_random_uuid(), 'chat_lightweight', NULL::uuid, NULL::text, NULL::text, NULL::uuid)`,
        ),
      ).toThrow(/requester/i);
    },
  );

  it.skipIf(!dbAvailable)(
    "compose_context denies a requester who lacks access to the story",
    () => {
      // a logged-in user (random sub) composing a story they don't own → Access denied.
      expect(() =>
        psqlQuery(
          `SELECT set_config('request.jwt.claim.sub', gen_random_uuid()::text, false); ` +
            `SET ROLE authenticated; ` +
            `SELECT public.compose_context(gen_random_uuid(), 'chat_lightweight', NULL::uuid, NULL::text, NULL::text, NULL::uuid)`,
        ),
      ).toThrow(/Access denied/i);
    },
  );
});
