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

import { createSafeLogger } from '@aisha/security';
import type { JWTPayload } from 'jose';
import { draftHelpInboxFlow } from '@aisha/flowboard-core';
import { rpcUserClaims } from '../postgrest.js';
import { draftArgsSchema, FLOWBOARD_TOOL_INPUTS } from './flowboard-tool-inputs.js';

const log = createSafeLogger('flowboard-mcp');

export async function flowboardDispatch(
  name: string,
  rawArgs: Record<string, unknown>,
  claims: JWTPayload,
): Promise<unknown> {
  switch (name) {
    case 'get_flowboard_registry': {
      FLOWBOARD_TOOL_INPUTS.get_flowboard_registry.parse(rawArgs ?? {});
      const agents = await rpcUserClaims('get_flowboard_agent_catalog', {}, claims);
      log.safeInfo('flowboard.registry.read');
      return { agents };
    }
    case 'draft_flow': {
      const parsed = draftArgsSchema.parse(rawArgs ?? {});
      log.safeInfo('flowboard.draft', { recipe: parsed.recipe });
      // Canonical recipe lives in @aisha/flowboard-core — no local duplicate.
      return draftHelpInboxFlow({ storyAgentSlug: parsed.agent_slug, mailbox: parsed.mailbox });
    }
    default:
      throw new Error(`Unknown flowboard tool: ${name}`);
  }
}
