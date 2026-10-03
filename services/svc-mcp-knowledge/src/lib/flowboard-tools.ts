/**
 * Flowboard MCP tools — the stack integration point for the visual builder.
 *
 *   - draft_flow             → AISHA Dirigent emits a draft FlowGraph (JSON) the
 *                              user finishes on the canvas. The canonical recipe
 *                              lives in @aisha/flowboard-core (single source of truth).
 *   - get_flowboard_registry → federated palette feed (active agent_catalog agents).
 *
 * Mirrors the aitg-tools dispatch shape: Zod-validated args, rpcUserClaims for
 * audited reads, single dispatcher early-returned from routes/mcp.ts.
 *
 * @module svc-mcp-knowledge/lib/flowboard-tools
 */

import { z } from 'zod';
import { createSafeLogger } from '@aisha/security';
import type { JWTPayload } from 'jose';
import { draftHelpInboxFlow } from '@aisha/flowboard-core';
import { rpcUserClaims } from '../postgrest.js';

const log = createSafeLogger('flowboard-mcp');

const draftArgsSchema = z.object({
  recipe: z.string().default('help_inbox'),
  agent_slug: z.string().optional(),
  mailbox: z.string().optional(),
});

export async function flowboardDispatch(
  name: string,
  args: Record<string, unknown>,
  claims: JWTPayload,
): Promise<unknown> {
  switch (name) {
    case 'get_flowboard_registry': {
      const agents = await rpcUserClaims('get_flowboard_agent_catalog', {}, claims);
      log.safeInfo('flowboard.registry.read');
      return { agents };
    }
    case 'draft_flow': {
      const parsed = draftArgsSchema.parse(args ?? {});
      log.safeInfo('flowboard.draft', { recipe: parsed.recipe });
      // Canonical recipe lives in @aisha/flowboard-core — no local duplicate.
      return draftHelpInboxFlow({ storyAgentSlug: parsed.agent_slug, mailbox: parsed.mailbox });
    }
    default:
      throw new Error(`Unknown flowboard tool: ${name}`);
  }
}
