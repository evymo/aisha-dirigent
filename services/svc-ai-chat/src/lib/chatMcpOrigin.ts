/**
 * MCP jako druhý původ nástrojů /chat (SELF_IMPROVEMENT_LOOP.md §3b, K-35).
 *
 * ⛔ NAMĚŘENO 2026-10-01: výchozí `allowed_tools` kanálu jsou jména nástrojů MCP
 * (search_knowledge, search_knowledge_v2, get_knowledge_item), /chat ale znal jen
 * `agent_tools` — chat tak neměl žádný nástroj. /v1 je volá přes mcpToolProxy; /chat
 * teď tutéž cestu používá jako druhý původ v executoru (žádná kopie definic).
 *
 * Hranice identity: původ vzniká VÝHRADNĚ ze zprostředkovaného tokenu uživatele
 * (mintMcpUserToken: sub = uživatel, role = authenticated), nikdy service klíčem —
 * service_role by obešel RLS i can_access_story. Bez tokenu (chybí podpisové tajemství
 * nebo uživatel) je původ `null` a executor MCP nástroje nenabídne ani nespustí.
 *
 * Do tokenu jde jen OVĚŘENÝ příběh: /chat přebírá `story_id` z požadavku bez kontroly
 * přístupu a MCP hledá v KB pod službou s `p_story_id` z tokenu (kontrolu příběhu pro
 * službu přeskakuje). Neověřený příběh by tak otevřel KB cizího příběhu. Ověří ho
 * `can_access_story` pod identitou uživatele; co nejde ověřit, jde bez příběhu (jen
 * globální KB).
 *
 * @module
 */
import type { PostgrestClient } from "./deps.js";
import type { McpToolOrigin } from "./toolExecutor.js";
import { mintMcpUserToken, mcpToolInvoke, mcpToolsList } from "./mcpToolProxy.js";
import { canAccessStory } from "./storyAccess.js";

/**
 * Příběh, na který uživatel smí — jinak `null` (chyba ověření = nesmí). /chat už příběh
 * z požadavku ověřil u vstupu (B8); tohle je druhá stráž přímo u ražby tokenu.
 */
export async function verifiedStoryForMcp(
  pgrestUser: PostgrestClient,
  storyId: string | null,
): Promise<string | null> {
  if (!storyId) return null;
  return (await canAccessStory(pgrestUser, storyId)) ? storyId : null;
}

/** Původ MCP pod identitou uživatele, nebo `null`, když zprostředkovaný token nevznikne. */
export async function createChatMcpOrigin(input: {
  userId: string;
  storyId: string | null;
  pgrestUser: PostgrestClient;
}): Promise<McpToolOrigin | null> {
  const userJwt = mintMcpUserToken(input.userId, await verifiedStoryForMcp(input.pgrestUser, input.storyId));
  if (!userJwt) return null;
  return {
    list: async () =>
      (await mcpToolsList(userJwt)).map((spec) => ({
        name: spec.function.name,
        description: spec.function.description,
        parameters: spec.function.parameters,
      })),
    call: (name, args) => mcpToolInvoke(userJwt, name, args),
  };
}
