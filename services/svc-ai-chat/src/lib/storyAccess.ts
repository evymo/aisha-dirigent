/**
 * Smí uživatel na příběh? Jediný predikát pro `story_id`, který přišel v požadavku (B8).
 *
 * ⛔ NAMĚŘENO 2026-10-01 na main 8640db9ac: /v1 (PAT bez vazby na příběh) i /chat převzaly
 * `story_id` z těla požadavku bez kontroly přístupu a poslaly ho dál pod službou — do tokenu
 * pro MCP (KB hledání pod službou kontrolu příběhu přeskakuje), do route_task, reflexe
 * a ukládání. Kdo znal UUID cizího příběhu, dostal jeho KB.
 *
 * Ověřuje `can_access_story` POD IDENTITOU UŽIVATELE (vlastník, účastník, admin/staff).
 * Chyba ověření = nesmí (fail-closed). Neexistující a cizí příběh dávají totéž `false`,
 * volající tak není orákulum existence příběhu.
 *
 * @module
 */
import type { PostgrestClient } from "./deps.js";
import { createUserScopedRpcAdapter } from "./userScopedRpc.js";

/** `true` jen když `can_access_story` pod identitou `pgrestUser` řekne ano. */
export async function canAccessStory(pgrestUser: PostgrestClient, storyId: string): Promise<boolean> {
  try {
    const { data, error } = await pgrestUser.rpc<boolean>("can_access_story", { p_story_id: storyId });
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Totéž pro volajícího známého jen podle id (vlastník Omni PATu). Bez uživatele = nesmí. */
export async function userCanAccessStory(userId: string | null, storyId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    return await canAccessStory(createUserScopedRpcAdapter(userId, "story-access-check"), storyId);
  } catch {
    // Ražba tokenu uživatele nejde (chybí podpisové tajemství) — bez ověření nic.
    return false;
  }
}
