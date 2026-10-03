/**
 * Gate test: RAG per-story isolation RBAC (mcp_search_knowledge_v3 + compose_context).
 *
 * Two pre-existing leaks let an authenticated user — or a service-role agent
 * path — read knowledge_items chunks scoped to a story they don't belong to.
 * Both functions are SECURITY DEFINER, so the per-story knowledge_items RLS
 * policy is bypassed inside them; the guard MUST live in the function body.
 *
 * LEAK 1 — mcp_search_knowledge_v3: GRANTed to `authenticated`, had no RBAC on
 *   p_story_id. Fixed by porting the v2 per-story guard (service_role bypass,
 *   else admin/owner/participant, else 42501) before the model-pref dispatch.
 *
 * LEAK 2 — compose_context: service-role-callable; its internal
 *   mcp_search_knowledge_v2(p_story_id) call bypasses v2's RBAC. The agent path
 *   (orchestrationBridge.enrichWithAishaContext) ran with no requester identity.
 *   Fixed by adding p_requester_id (admin/owner/participant else 42501) and
 *   threading the acting user's id from the user-facing routes. The contract was
 *   later HARDENED (commit b9b301df): a story-scoped call with no resolvable
 *   requester identity is fail-closed (42501) — a background job must pass an
 *   explicit system principal as p_requester_id rather than rely on a silent
 *   service-role / NULL-requester bypass.
 *
 * This gate locks the SoT guards + the wiring so any regression (guard removal,
 * GRANT widening, dropped p_requester_id threading, re-adding the no-auth
 * allowlist entry) fails CI. The runtime proof of denial/allow lives in the
 * pgTAP suite aisha/db/tests/schema/02_rag_isolation_rbac.sql (cold-start gate).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const V3 = path.join(ROOT, 'aisha/db/sql/functions/mcp_search_knowledge_v3.sql');
const V2 = path.join(ROOT, 'aisha/db/sql/functions/mcp_search_knowledge_v2.sql');
const GET_ITEM = path.join(ROOT, 'aisha/db/sql/functions/mcp_get_knowledge_item.sql');
const COMPOSE = path.join(ROOT, 'aisha/db/sql/functions/compose_context.sql');
const BASELINE = path.join(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql');
const BRIDGE = path.join(ROOT, 'services/svc-ai-chat/src/lib/orchestrationBridge.ts');
const CHAT = path.join(ROOT, 'services/svc-ai-chat/src/routes/chat.ts');
const STORY_CONSULT = path.join(ROOT, 'services/svc-ai-chat/src/routes/story-consult.ts');
const KNOWN_ISSUES = path.join(ROOT, 'src/tests/gates/security-known-issues.ts');
const PGTAP = path.join(ROOT, 'aisha/db/tests/schema/02_rag_isolation_rbac.sql');

function readText(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

/**
 * Extract the body of a `SELECT 1 FROM partner_stories … OR … story_participants`
 * ownership/participation guard that RAISEs 42501. Returns true when the file
 * contains an admin/owner/participant check tied to a 42501 access-denied raise.
 */
function hasPerStoryGuard(sql: string, storyArg: string): boolean {
  const has42501 = /ERRCODE\s*=\s*'42501'/.test(sql);
  const hasAdmin = /is_admin_or_staff\s*\(/.test(sql);
  const hasOwner = new RegExp(
    `partner_stories\\s+ps[\\s\\S]{0,120}ps\\.user_id\\s*=\\s*${storyArg}`,
  ).test(sql) || /partner_stories\s+ps[\s\S]{0,160}ps\.user_id/.test(sql);
  const hasParticipant = /story_participants\s+sp[\s\S]{0,160}sp\.user_id/.test(sql);
  return has42501 && hasAdmin && hasOwner && hasParticipant;
}

describe('RAG isolation — LEAK 1: mcp_search_knowledge_v3 per-story RBAC', () => {
  const v3 = readText(V3);

  it('SoT file exists and is SECURITY DEFINER granted to authenticated', () => {
    expect(v3.length).toBeGreaterThan(0);
    expect(v3).toMatch(/SECURITY DEFINER/i);
    expect(v3).toMatch(/GRANT EXECUTE ON FUNCTION mcp_search_knowledge_v3[\s\S]*TO authenticated/);
  });

  it('enforces the per-story admin/owner/participant guard with 42501', () => {
    expect(hasPerStoryGuard(v3, 'v_caller_id'), 'v3 must contain the per-story RBAC guard').toBe(true);
  });

  it('bypasses only for service_role (DISTINCT FROM check), keyed on p_story_id', () => {
    expect(v3).toMatch(/get_jwt_role\s*\(\s*\)/);
    expect(v3).toMatch(/IS DISTINCT FROM\s+'service_role'/);
    expect(v3).toMatch(/p_story_id IS NOT NULL/);
  });

  it("the guard runs before the model-pref dispatch (covers both v1 and v2 branches)", () => {
    const guardIdx = v3.search(/ERRCODE\s*=\s*'42501'/);
    const dispatchIdx = v3.search(/IF\s+p_model_pref\s*=\s*'v2'\s+THEN/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(dispatchIdx).toBeGreaterThan(-1);
    expect(guardIdx, 'the 42501 guard must precede the v1/v2 RETURN QUERY dispatch').toBeLessThan(
      dispatchIdx,
    );
  });

  it('matches the canonical guard already present in mcp_search_knowledge_v2', () => {
    const v2 = readText(V2);
    expect(hasPerStoryGuard(v2, 'v_caller_id')).toBe(true);
  });

  it('LEAK 1b: per-story filter is the secure v2 form (NULL p_story_id ⇒ globals only)', () => {
    // The guard only fires for a non-NULL p_story_id; the FILTER must independently
    // ensure a NULL p_story_id returns only global/brain items, never every story.
    // Old, unsafe form made the whole clause TRUE for NULL p_story_id:
    expect(v3, 'the unsafe `p_story_id IS NULL OR ki.story_id IS NULL …` filter must be gone').not.toMatch(
      /\(\s*p_story_id IS NULL OR ki\.story_id IS NULL OR ki\.story_id = p_story_id\s*\)/,
    );
    // Secure form (verbatim from v2): brain ∪ (NULL⇒global) ∪ (X⇒X+global).
    expect(v3).toMatch(/item_type::text IN \('core_value', 'personality_trait'\)/);
    expect(v3).toMatch(/p_story_id IS NULL AND ki\.story_id IS NULL/);
    expect(v3).toMatch(/p_story_id IS NOT NULL AND \(ki\.story_id = p_story_id OR ki\.story_id IS NULL\)/);
  });
});

describe('RAG isolation — sibling leaks in the same boundary (global accessors)', () => {
  const v2 = readText(V2);
  const getItem = readText(GET_ITEM);

  it('LEAK 3: 9-arg mcp_search_knowledge_v2 (no p_story_id) is restricted to global items', () => {
    // The no-story overload must never return story-scoped (public-by-default) items.
    expect(v2).toMatch(/AND ki\.story_id IS NULL/);
    // It is the overload sitting right after the quarantine filter (9-arg only).
    expect(v2).toMatch(
      /quarantine_status NOT IN \('flagged', 'quarantined'\)[\s\S]{0,800}AND ki\.story_id IS NULL/,
    );
  });

  it('LEAK 4: mcp_get_knowledge_item gates story-scoped items by membership (no service bypass)', () => {
    expect(getItem.length).toBeGreaterThan(0);
    expect(getItem).toMatch(/SECURITY DEFINER/i);
    // Global items stay public; story items require owner/participant/admin.
    expect(getItem).toMatch(/ki\.story_id IS NULL/);
    expect(getItem).toMatch(/is_admin_or_staff\s*\(\s*auth\.uid\(\)\s*\)/);
    expect(getItem).toMatch(/partner_stories\s+ps[\s\S]{0,120}ps\.user_id\s*=\s*auth\.uid\(\)/);
    expect(getItem).toMatch(/story_participants\s+sp[\s\S]{0,120}sp\.user_id\s*=\s*auth\.uid\(\)/);
    // Must NOT contain a service_role bypass in the data filter (the MCP tool
    // dispatches this as service_role, which would re-open the leak).
    expect(getItem, 'no service_role bypass may gate story access here').not.toMatch(
      /get_jwt_role\(\)\s*=\s*'service_role'|current_setting\('role'[\s\S]{0,40}service_role/,
    );
  });
});

describe('RAG isolation — LEAK 2: compose_context requester guard', () => {
  const compose = readText(COMPOSE);

  it('declares the p_requester_id parameter (6-arg signature)', () => {
    expect(compose).toMatch(/p_requester_id\s+uuid\s+DEFAULT\s+NULL/i);
  });

  it('enforces the requester ownership/participation guard with 42501', () => {
    expect(hasPerStoryGuard(compose, 'p_requester_id')).toBe(true);
    // Guard must be gated on a non-NULL requester (NULL = system bypass).
    expect(compose).toMatch(/p_requester_id IS NOT NULL/);
  });

  it('drops the legacy 5-arg signature and re-grants the 6-arg one', () => {
    expect(compose).toMatch(
      /DROP FUNCTION IF EXISTS public\.compose_context\(uuid, text, uuid, text, text\)/,
    );
    expect(compose).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.compose_context\(uuid, text, uuid, text, text, uuid\) TO authenticated/,
    );
    expect(compose).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.compose_context\(uuid, text, uuid, text, text, uuid\) TO service_role/,
    );
    // The unguarded 5-arg GRANT must be gone.
    expect(compose).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.compose_context\(uuid, text, uuid, text, text\)\s+TO/,
    );
  });

  it('runs the requester guard before loading the profile (fail-closed)', () => {
    const guardIdx = compose.search(/p_requester_id IS NOT NULL/);
    const loadIdx = compose.search(/FROM context_profiles[\s\S]{0,60}WHERE slug/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(loadIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(loadIdx);
  });
});

describe('RAG isolation — agent path threads the requester id', () => {
  const bridge = readText(BRIDGE);
  const chat = readText(CHAT);
  const consult = readText(STORY_CONSULT);

  it('orchestrationBridge exposes requesterId and forwards it as p_requester_id', () => {
    expect(bridge).toMatch(/requesterId\?\s*:\s*string/);
    expect(bridge).toMatch(/if\s*\(\s*requesterId\s*\)\s*rpcParams\.p_requester_id\s*=\s*requesterId/);
  });

  it('chat route passes the acting user id as requesterId', () => {
    expect(chat).toMatch(/enrichWithAishaContext\([\s\S]{0,400}requesterId:\s*userId/);
  });

  it('story-consult route passes the acting user id as requesterId', () => {
    expect(consult).toMatch(/enrichWithAishaContext\([\s\S]{0,400}requesterId:\s*userId/);
  });

  it('both routes derive userId from the canonical .userId field (not undefined .sub)', () => {
    // verifyToken maps the JWT sub onto VerifiedUser.userId; reading `.sub`
    // yields undefined, which would silently disable the guard (NULL requester).
    expect(chat).toMatch(/id:\s*verified\.userId/);
    expect(consult).toMatch(/const userId = user\.userId/);
  });
});

describe('RAG isolation — regenerated baseline carries both guards', () => {
  const baseline = readText(BASELINE);

  it('baseline includes the v3 per-story guard', () => {
    expect(baseline).toMatch(/CREATE OR REPLACE FUNCTION public\.mcp_search_knowledge_v3/);
    expect(hasPerStoryGuard(baseline, 'v_caller_id')).toBe(true);
  });

  it('baseline includes compose_context p_requester_id guard + 6-arg grant', () => {
    expect(baseline).toMatch(/p_requester_id\s+uuid\s+DEFAULT\s+NULL/i);
    expect(baseline).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.compose_context\(uuid, text, uuid, text, text, uuid\) TO authenticated/,
    );
  });
});

describe('RAG isolation — no-auth allowlist + runtime proof', () => {
  it('compose_context is removed from the SECURITY DEFINER no-auth allowlist', () => {
    const known = readText(KNOWN_ISSUES);
    expect(known.length).toBeGreaterThan(0);
    // Must not be an active array entry any more (a real auth check now exists).
    expect(known).not.toMatch(/^\s*'compose_context',\s*$/m);
  });

  it('pgTAP runtime denial/allow proof exists for all four cases', () => {
    const pgtap = readText(PGTAP);
    expect(pgtap.length).toBeGreaterThan(0);
    // (a) v3 foreign story denial, (b) compose_context foreign requester denial,
    // (c) owner/participant/admin allow, (d) v3 service_role bypass allow +
    // compose_context fail-closed when no requester identity is resolvable.
    expect(pgtap).toMatch(/throws_ok[\s\S]{0,400}mcp_search_knowledge_v3[\s\S]{0,500}'42501'/);
    expect(pgtap).toMatch(/throws_ok[\s\S]{0,400}compose_context[\s\S]{0,500}'42501'/);
    expect(pgtap).toMatch(/service_role bypass is allowed/);
    // HARDENED contract (commit b9b301df): a story-scoped compose_context call with
    // no resolvable requester identity is REFUSED (42501), not silently bypassed.
    expect(pgtap).toMatch(/no requester identity is refused.*42501/);
    // Data-level proofs for the filter-based leaks the guards don't cover.
    expect(pgtap, 'D1: v3 NULL p_story_id must not leak story chunks').toMatch(
      /is_empty[\s\S]{0,400}p_story_id := NULL[\s\S]{0,200}story_item/,
    );
    expect(pgtap, 'D4: mcp_get_knowledge_item anon story denial').toMatch(
      /mcp_get_knowledge_item[\s\S]{0,200}story_item[\s\S]{0,80}NULL/,
    );
  });
});
