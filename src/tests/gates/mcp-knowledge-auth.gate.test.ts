/**
 * KB MCP (svc-mcp-knowledge) service-layer auth gate.
 *
 * The DB layer already locks per-user authorization: knowledge-tier-acl.gate +
 * rag-isolation-rbac.gate + the pgTAP runtime deny/allow proofs
 * (aisha/db/tests/schema/11_knowledge_tier_acl.sql, mcp_search_knowledge_v3/v2
 * per-story RBAC). This gate locks the SERVICE layer of routes/mcp.ts, which those
 * DB gates cannot see — the ways the tier-ACL / per-story guard could be defeated
 * from ABOVE even with correct DB functions:
 *
 *   1. Tool dispatch must be fail-closed — every tool call goes through
 *      verifyMcpAccess (a bad/absent token must never reach a tool).
 *   2. The tier-ACL key p_audience_user_id must be bound to the AUTHENTICATED
 *      caller (auth.user.claims.sub), NEVER a client-supplied arg — else a caller
 *      could pass another user's id and inherit their tier.
 *   3. The per-story key p_story_id must come from the token claims
 *      (storyIdFromClaims(auth)), NEVER client args — else cross-story escalation.
 *   4. User-facing story/context tools must run user-scoped (rpcUserClaims with the
 *      caller's claims), so PostgREST RLS applies — not a blanket service_role call.
 *
 * ⛔ B8 (2026-10-01): this header used to say search RPCs "legitimately run via
 * rpcService (the DB function pins the passed audience/story)". It does NOT pin the
 * story for service_role — v2/v3 SKIP the per-story guard for the service role, so a
 * claim nobody verified opened another story's KB. The search path now runs under the
 * user's identity (rpcUserClaims); kb-pribeh-jen-pod-uzivatelem.gate enforces that.
 * This gate still bans deriving the identity keys from anything but the verified token.
 */

import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MCP = join(ROOT, "services/svc-mcp-knowledge/src/routes/mcp.ts");

describe("KB MCP service-layer auth (routes/mcp.ts)", () => {
  const src = existsSync(MCP) ? readFileSync(MCP, "utf8") : "";

  // The tier-ACL / per-story identity binding matters in the SEARCH path
  // (searchKnowledgeProd), which must derive the keys from the verified token
  // (and since B8 runs under the user's identity). User-scoped tools (rpcUserClaims) legitimately pass
  // args.story_id because PostgREST RLS re-checks the caller — so the "not from
  // args" guards are scoped to the search function body only.
  const searchStart = src.indexOf("async function searchKnowledgeProd");
  const afterSearch = src.indexOf("async function callTool");
  const searchBody = searchStart >= 0 ? src.slice(searchStart, afterSearch > searchStart ? afterSearch : undefined) : "";

  test("the MCP route exists and dispatches tools only after verifyMcpAccess (fail-closed)", () => {
    expect(existsSync(MCP), "services/svc-mcp-knowledge/src/routes/mcp.ts must exist").toBe(true);
    // Auth is verified from the Authorization header before any tool runs.
    expect(src, "must verify access from the Authorization header").toMatch(
      /verifyMcpAccess\(\s*req\.headers\.authorization/,
    );
    // The verifier returns a typed auth context that gates callTool.
    expect(src, "callTool must take the verified McpAuthContext").toMatch(
      /callTool\([^)]*auth\s*:\s*McpAuthContext/,
    );
  });

  test("tier-ACL key p_audience_user_id is bound to the authenticated caller, not client args", () => {
    // audienceUserId must come from auth.user.claims.sub — the verified identity.
    expect(src, "audienceUserId must derive from auth.user.claims.sub").toMatch(
      /audienceUserId\s*=\s*asString\(\(auth\.user\.claims[^)]*\)\.sub\)/,
    );
    // And it must be what the SEARCH path passes to the tier-ACL functions.
    expect(searchBody, "search must pass p_audience_user_id: audienceUserId").toMatch(
      /p_audience_user_id:\s*audienceUserId/,
    );
    // Guard: within search, p_audience_user_id must NEVER be sourced from client args.
    expect(searchBody, "search p_audience_user_id must NOT come from client args").not.toMatch(
      /p_audience_user_id:\s*asString\(\s*args\./,
    );
    // Čtení podle id (get_knowledge_item) běží taky servisní rolí a publikum předává stejně:
    // z ověřeného tokenu, nikdy z argumentů. Do 2026-10-04 ho nepředávalo vůbec — každý
    // uživatel MCP četl podle id jako anonym.
    const getItemBody = /case 'get_knowledge_item':[\s\S]*?rpcService\('mcp_get_knowledge_item',[\s\S]*?\}\);/.exec(src)?.[0] ?? "";
    expect(getItemBody.length, "větev get_knowledge_item se v route nenašla").toBeGreaterThan(0);
    expect(getItemBody, "get_knowledge_item: audienceUserId must derive from auth.user.claims.sub").toMatch(
      /audienceUserId\s*=\s*asString\(\(auth\.user\.claims[^)]*\)\.sub\)/,
    );
    expect(getItemBody, "get_knowledge_item must pass p_audience_user_id: audienceUserId").toMatch(/p_audience_user_id:\s*audienceUserId\b/);
    expect(getItemBody, "get_knowledge_item p_audience_user_id must NOT come from client args").not.toMatch(/args\.[a-z_]*audience/i);
  });

  test("per-story key p_story_id comes from token claims (storyIdFromClaims), not client args", () => {
    // storyIdFromClaims reads the token claim, not the request body.
    expect(src, "storyIdFromClaims must read auth.user.claims").toMatch(
      /function storyIdFromClaims\(auth: McpAuthContext\)[\s\S]{0,220}auth\.user\.claims/,
    );
    expect(searchBody, "search must bind storyId from the claims helper").toMatch(
      /storyId\s*=\s*storyIdFromClaims\(auth\)/,
    );
    // Guard: the SEARCH RPCs must pass p_story_id: storyId (claims), not args.story_id.
    expect(searchBody, "search must pass p_story_id: storyId").toMatch(/p_story_id:\s*storyId/);
    expect(searchBody, "search p_story_id must NOT come from client args").not.toMatch(
      /p_story_id:\s*asString\(\s*args\.story_id/,
    );
  });

  test("user-facing story/context tools run user-scoped (rpcUserClaims with the caller claims)", () => {
    // compose_context / route_task / story detail must carry the caller's claims so
    // PostgREST RLS applies — a blanket rpcService here would drop per-user isolation.
    expect(src, "user-facing tools must use rpcUserClaims with auth.user.claims").toMatch(
      /rpcUserClaims\([\s\S]{0,400}auth\.user\.claims/,
    );
  });
});
