/**
 * Flowboard — canonical recipes the AISHA auto-builder (Dirigent `draft_flow`)
 * emits. A recipe is just a validated FlowGraph; the user finishes it on the
 * canvas and publishes. Kept with the core so the schema is the single source
 * of truth and the output is unit-tested.
 *
 * @module flowboard/recipes
 */

import { flowGraphSchema, type FlowGraph } from "./graph.js";

export interface DraftHelpInboxOptions {
  /** agent_catalog slug used for triage/routing (must exist on the stack). */
  storyAgentSlug?: string;
  mailbox?: string;
  graphId?: string;
}

/**
 * "E-mail na help@ → založ story → triage agent → pošli přijetí."
 * Low-sensitivity → routes to n8n. The exact flow from the product brief.
 */
export function draftHelpInboxFlow(opts: DraftHelpInboxOptions = {}): FlowGraph {
  const agentSlug = opts.storyAgentSlug ?? "knowledge";
  const mailbox = opts.mailbox ?? "help@";
  return flowGraphSchema.parse({
    id: opts.graphId ?? "recipe-help-inbox",
    name: "Help inbox → přijetí → routing",
    nodes: [
      { id: "t", typeId: "trigger.email_inbound", position: { x: 0, y: 0 }, config: { mailbox } },
      { id: "s", typeId: "action.story_entry", position: { x: 240, y: 0 }, config: { entry_type: "automation_step" } },
      { id: "a", typeId: `agent.${agentSlug}`, position: { x: 480, y: 0 }, config: {} },
      { id: "ack", typeId: "action.email_send", position: { x: 720, y: 0 }, config: {} },
    ],
    edges: [
      { id: "e1", source: "t", sourcePort: "out", target: "s", targetPort: "in" },
      { id: "e2", source: "s", sourcePort: "out", target: "a", targetPort: "in" },
      { id: "e3", source: "a", sourcePort: "out", target: "ack", targetPort: "in" },
    ],
    meta: { recipe: "help_inbox", generatedBy: "aisha-dirigent" },
  });
}
