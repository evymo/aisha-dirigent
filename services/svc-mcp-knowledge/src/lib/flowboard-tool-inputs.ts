/**
 * Vstupní schémata nástrojů flowboardu — JEDINÝ zdroj jejich rozhraní (zod v4). Validuje je
 * dispatch (flowboard-tools.ts), tools/list z nich staví inputSchema (routes/mcp.ts).
 * Bez vedlejších efektů — importovatelné i tam, kde se dispatch mockuje.
 *
 * @module
 */
import { z } from 'zod/v4';

export const draftArgsSchema = z.object({
  recipe: z.string().default('help_inbox').describe('Recipe to draft (beta: help_inbox).'),
  agent_slug: z.string().optional().describe('Story agent that handles the drafted flow.'),
  mailbox: z.string().optional().describe('Mailbox the flow listens to.'),
});

/** Rozhraní nástrojů flowboardu pro tools/list (z.toJSONSchema) — totéž, co validuje dispatch. */
export const FLOWBOARD_TOOL_INPUTS = {
  get_flowboard_registry: z.object({}),
  draft_flow: draftArgsSchema,
} as const;
