/**
 * ISseClient — platform-agnostic Server-Sent Events client interface.
 *
 * Implemented by AishaPushClient (Node + fetch) for the extension and
 * workbench. Auth headers are injected via IAuthAdapter.
 *
 * @module
 */

/** Push event types emitted by the AISHA backend over SSE. */
export type AishaPushEventType =
  | "model_discovered"
  | "eval_completed"
  | "proposal_created"
  | "alert"
  | "info"
  | "recommendation"
  | "rules_updated"
  | "story_share";

/** Structured push event from the AISHA backend. */
export interface AishaPushEvent {
  type: AishaPushEventType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

/** Callback invoked when a push event is received. */
export type PushEventHandler = (event: AishaPushEvent) => void;

/** Connection status of the SSE channel. */
export type SseConnectionStatus = "connected" | "disconnected" | "reconnecting";

/** Platform-agnostic SSE client contract. */
export interface ISseClient {
  /** Current connection status. */
  readonly status: SseConnectionStatus;

  /**
   * Start (or restart) the SSE connection.
   * @param url - SSE endpoint URL
   * @param headers - authentication headers (from IAuthAdapter.getAuthHeaders())
   */
  connect(headers: Record<string, string>, url: string): void;

  /** Gracefully disconnect and stop reconnection attempts. */
  disconnect(): void;

  /**
   * Register a handler for incoming push events.
   * @returns A cleanup function that removes the handler.
   */
  onEvent(handler: PushEventHandler): () => void;

  /**
   * Register a handler for status changes.
   * @returns A cleanup function that removes the handler.
   */
  onStatusChange(handler: (status: SseConnectionStatus) => void): () => void;
}
