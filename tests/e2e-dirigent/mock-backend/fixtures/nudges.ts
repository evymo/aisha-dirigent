/**
 * Canned responses for /rpc/dirigent_drain_nudges.
 *
 * Specs override via POST /__test__/queue-nudge { ...row }
 * Each call to /rpc/dirigent_drain_nudges drains (and removes) the queue.
 */

export interface Nudge {
  id: string;
  story_id: string | null;
  conversation_id: string | null;
  event_origin: string;
  severity: "info" | "moderate" | "high";
  message: string;
  created_at: string;
}

/** Mutable queue — server module mutates this. Initial state: empty. */
export const NUDGE_QUEUE: Nudge[] = [];
