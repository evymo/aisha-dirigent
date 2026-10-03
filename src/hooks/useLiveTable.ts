/**
 * useLiveTable — shared realtime + React Query subscription.
 *
 * Wraps `aisha.channel(...).on('postgres_changes', ...).subscribe()` with:
 *   - Refcounted channel dedup (multiple subscribers to the same
 *     (table, filter) tuple share one underlying WebSocket channel)
 *   - React Query cache invalidation on every realtime event
 *   - Channel budget warning when more than 24 channels are active per tab
 *
 * Initial data comes from the `rpc` function (called by React Query on
 * mount). On every postgres_changes event the queryKey is invalidated, so
 * the RPC is re-fetched. The RPC is the source of truth; we do NOT merge
 * realtime payloads into the cache directly.
 *
 * Why module-level singleton over a Context provider:
 *   - Channel dedup works regardless of which React tree mounts the hook,
 *     so a Provider would only add boilerplate without adding value
 *   - Test isolation is handled via `_resetLiveTableRegistry` for vitest
 *
 * @module hooks/useLiveTable
 */

import { useEffect, useRef } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { ChangeFilter } from "@aisha/api-core";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

// ============================================================================
// Constants
// ============================================================================

/**
 * Soft cap on simultaneous realtime channels per tab. The postgres-meta
 * backend's hard ceiling is ~100 channels/client; we warn at 24 so the
 * mission-control surfaces can stay well below that with room for
 * coexisting features.
 */
export const MAX_LIVE_CHANNELS = 24;

// ============================================================================
// Module-level channel registry (singleton)
// ============================================================================

interface ChannelEntry {
  channelName: string;
  table: string;
  filter: string | undefined;
  subscribers: Set<() => void>;
}

const registry = new Map<string, ChannelEntry>();

function channelKey(table: string, filter: string | undefined): string {
  return filter ? `live::${table}::${filter}` : `live::${table}`;
}

/**
 * Subscribe to (table, filter) realtime events. Returns a release fn that
 * decrements the refcount and removes the channel when the last subscriber
 * unmounts.
 */
function acquire(
  table: string,
  filter: string | undefined,
  onEvent: () => void,
): () => void {
  const key = channelKey(table, filter);
  let entry = registry.get(key);

  if (!entry) {
    if (registry.size >= MAX_LIVE_CHANNELS) {
      safeError(
        "useLiveTable",
        new Error(
          `Realtime channel budget exceeded: ${registry.size}/${MAX_LIVE_CHANNELS} active. New channel for ${key} may strain postgres-meta — consider broader subscriptions + client-side filtering.`,
        ),
      );
    }

    entry = {
      channelName: key,
      table,
      filter,
      subscribers: new Set(),
    };
    registry.set(key, entry);

    // The aisha client (@/integrations/db/client) dedupes channel(name) by
    // name internally, so calling aisha.channel(key) elsewhere returns the
    // same RealtimeChannel instance — but our refcount layer guarantees we
    // do not removeChannel while other subscribers still use it.
    const changeFilter: ChangeFilter = filter
      ? {
          event: "*",
          schema: "public",
          table,
          filter,
        }
      : {
          event: "*",
          schema: "public",
          table,
        };

    aisha
      .channel(key)
      .on("postgres_changes", changeFilter, () => {
        // Re-read the entry inside the callback — subscribers may have
        // attached/detached between channel setup and event firing.
        const current = registry.get(key);
        if (!current) return;
        for (const fn of current.subscribers) {
          try {
            fn();
          } catch (err) {
            safeError("useLiveTable.subscriberCallback", err);
          }
        }
      })
      .subscribe();
  }

  entry.subscribers.add(onEvent);

  return () => {
    const current = registry.get(key);
    if (!current) return;
    current.subscribers.delete(onEvent);
    if (current.subscribers.size === 0) {
      const channel = aisha.channel(key);
      aisha.removeChannel(channel);
      registry.delete(key);
    }
  };
}

// ============================================================================
// Hook
// ============================================================================

export interface UseLiveTableOptions<T> {
  /** Postgres table to subscribe to (without schema prefix). */
  table: string;
  /**
   * Optional postgres-meta filter expression, e.g. `story_id=eq.<uuid>`.
   * Subscribers with the same `(table, filter)` tuple share one underlying
   * channel.
   */
  filter?: string;
  /** React Query key used for caching. Invalidated on every realtime event. */
  queryKey: QueryKey;
  /** Initial fetch fn. Re-runs on mount and on every realtime event. */
  rpc: () => Promise<T[]>;
  /** Disable both the query and the subscription. Default `true`. */
  enabled?: boolean;
  /**
   * React Query staleTime (ms). Default `0` — invalidations always refetch.
   * Increase if your callers tolerate slightly stale data between events.
   */
  staleTime?: number;
}

/**
 * Subscribe to a Postgres table with React Query cache-driven updates.
 *
 * @example
 * ```ts
 * const { data: runs = [] } = useLiveTable({
 *   table: "ai_runs",
 *   queryKey: ["ai_runs", "recent"],
 *   rpc: async () => {
 *     const { data } = await aisha.rpc("list_agent_runs", { p_limit: 20 });
 *     return data ?? [];
 *   },
 * });
 * ```
 */
export function useLiveTable<T>(
  opts: UseLiveTableOptions<T>,
): UseQueryResult<T[]> {
  const { table, filter, queryKey, rpc, enabled = true, staleTime = 0 } = opts;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey,
    enabled,
    staleTime,
    queryFn: rpc,
  });

  // Subscribe to realtime events for this (table, filter) tuple.
  // queryKeyHash is the stable serialization the effect keys on (resubscribe
  // only when the serialized key actually changes, not on every referentially-
  // new inline array). queryKeyRef carries the live value into the callback
  // without widening the dep array — this preserves the exact resubscribe
  // semantics while satisfying exhaustive-deps (no inline complex expression,
  // no missing dep).
  const queryKeyHash = JSON.stringify(queryKey);
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;
  useEffect(() => {
    if (!enabled) return undefined;
    const release = acquire(table, filter, () => {
      queryClient.invalidateQueries({ queryKey: queryKeyRef.current });
    });
    return release;
  }, [enabled, table, filter, queryKeyHash, queryClient]);

  return query;
}

// ============================================================================
// Diagnostics
// ============================================================================

/**
 * Snapshot of the live-channel registry for the /admin/diagnostics page
 * (Phase 0 deliverable per plan). Read-only.
 */
export function getLiveTableTelemetry(): {
  activeChannels: number;
  maxChannels: number;
  channels: Array<{
    key: string;
    table: string;
    filter: string | undefined;
    subscriberCount: number;
  }>;
} {
  return {
    activeChannels: registry.size,
    maxChannels: MAX_LIVE_CHANNELS,
    channels: Array.from(registry.values()).map((e) => ({
      key: e.channelName,
      table: e.table,
      filter: e.filter,
      subscriberCount: e.subscribers.size,
    })),
  };
}

/**
 * Test-only: clears the registry and tears down active channels. Required
 * because the registry is module-level and persists across tests in the
 * same vitest worker.
 *
 * Do NOT call from production code paths.
 */
export function _resetLiveTableRegistry(): void {
  for (const [key] of registry) {
    try {
      const channel = aisha.channel(key);
      aisha.removeChannel(channel);
    } catch {
      // Silent — best effort cleanup during test teardown.
    }
  }
  registry.clear();
}
