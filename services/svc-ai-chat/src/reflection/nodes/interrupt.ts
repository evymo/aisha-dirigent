import type { NodeHandler } from '../types.js';

/**
 * Interrupt node — pauses the run with status=waiting_human.
 * Downstream caller resumes via POST /runs/:id/approval.
 *
 * Config:
 *   - channel: 'telegram' | 'slack' | 'matrix' | 'in_app'
 *   - approver: agent_slug or user identifier
 *   - reason: optional description for the approval card
 */
export const interruptNode: NodeHandler = async (ctx) => {
  const cfg = ctx.node.config;
  const channel = (cfg.channel as string) ?? 'in_app';
  const approver = (cfg.approver as string) ?? 'dirigent';
  const reason = (cfg.reason as string) ?? 'manual_approval_required';

  // The runner will set status=waiting_human + emit notify event;
  // the actual channel notification is sent via openclaw_notify (if available)
  // and / or simply waits for /approval endpoint call.

  return {
    output_data: {
      channel,
      approver,
      reason,
      message: 'Run paused; awaiting human approval. POST /runs/:id/approval to resume.',
    },
    state_patch: { pending_approval: { channel, approver, reason } },
    interrupt: true,
    transition_key: 'awaiting_human',
  };
};
