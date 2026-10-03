/**
 * Signal — Lightweight publish/subscribe for cache invalidation and event propagation.
 *
 * Inspired by Claude Code's `createSignal()` pattern. Provides a simple way to notify
 * subscribers when data changes, enabling cache busting without tight coupling.
 *
 * Use cases:
 *   - KB item updates → invalidate memoized context in workflow engine
 *   - Skill file changes → refresh skill registry in VS Code extension
 *   - Agent config changes → bust cached agent configs mid-session
 *
 * Usage:
 *   const contextInvalidated = createSignal<{ reason: string }>();
 *   const unsubscribe = contextInvalidated.subscribe((data) => {
 *     console.log("Context invalidated:", data.reason);
 *     cachedContext = null;
 *   });
 *   contextInvalidated.emit({ reason: "kb_item_updated" });
 *   unsubscribe(); // cleanup
 *
 * @module
 */

// =============================================================================
// Types
// =============================================================================

/** Subscriber callback function. */
type SignalSubscriber<T> = (data: T) => void;

/** Unsubscribe function returned by subscribe(). */
type Unsubscribe = () => void;

/** A typed signal that can be emitted and subscribed to. */
export interface Signal<T> {
  /** Emit a value to all current subscribers. */
  emit(data: T): void;
  /** Subscribe to future emissions. Returns an unsubscribe function. */
  subscribe(fn: SignalSubscriber<T>): Unsubscribe;
  /** Number of active subscribers. */
  readonly subscriberCount: number;
  /** Remove all subscribers. */
  clear(): void;
}

/** Payload for context invalidation signals. */
export interface ContextInvalidationPayload {
  reason: string;
  source: string;
  timestamp: number;
  entityType?: string;
  entityId?: string;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new typed signal.
 *
 * Signals are synchronous — subscribers are called immediately on emit().
 * This is intentional for cache invalidation where you want immediate effect.
 */
export function createSignal<T>(): Signal<T> {
  const subscribers = new Set<SignalSubscriber<T>>();

  return {
    emit(data: T): void {
      for (const fn of subscribers) {
        try {
          fn(data);
        } catch {
          // Subscriber errors should not propagate — fire-and-forget
        }
      }
    },

    subscribe(fn: SignalSubscriber<T>): Unsubscribe {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },

    get subscriberCount(): number {
      return subscribers.size;
    },

    clear(): void {
      subscribers.clear();
    },
  };
}

// =============================================================================
// Global Signals — Singleton instances for cross-module communication
// =============================================================================

/** Signal emitted when knowledge base items are updated/created/deleted. */
export const knowledgeUpdated = createSignal<ContextInvalidationPayload>();

/** Signal emitted when agent configurations change. */
export const agentConfigUpdated = createSignal<ContextInvalidationPayload>();

/** Signal emitted when expert rules or rulesets change. */
export const rulesetUpdated = createSignal<ContextInvalidationPayload>();

// =============================================================================
// Memoize with Signal Invalidation
// =============================================================================

/**
 * Create a memoized value that auto-invalidates when a signal fires.
 *
 * Usage:
 *   const getContext = memoizeWithSignal(
 *     () => expensiveContextComposition(),
 *     knowledgeUpdated,
 *   );
 *   const ctx1 = await getContext(); // computes
 *   const ctx2 = await getContext(); // cached
 *   knowledgeUpdated.emit({ reason: "kb_update", ... }); // invalidates
 *   const ctx3 = await getContext(); // re-computes
 */
export function memoizeWithSignal<T>(
  factory: () => T | Promise<T>,
  invalidationSignal: Signal<unknown>,
): () => Promise<T> {
  let cached: T | undefined;
  let pending: Promise<T> | undefined;

  invalidationSignal.subscribe(() => {
    cached = undefined;
    pending = undefined;
  });

  return async () => {
    if (cached !== undefined) return cached;
    if (pending) return pending;

    pending = Promise.resolve(factory()).then((result) => {
      cached = result;
      pending = undefined;
      return result;
    });

    return pending;
  };
}
