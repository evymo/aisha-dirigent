/**
 * AI Memory Manager for Edge Functions
 *
 * Provides session-scoped (working) and long-term (cross-session) memory
 * management for the AI agent. All operations are persisted via RPCs and
 * traced through the observability layer.
 *
 * Session memory: conversation-scoped key-value store that avoids
 * redundant tool calls and context loading across turns.
 *
 * Long-term memory: user-scoped preferences, known conditions, and
 * communication style that persist across conversations.
 *
 * Security:
 * - Session memory is scoped to (conversation_id, user_id)
 * - Long-term memory writes are audited to audit_journal
 * - No PHI/PII stored in memory values — only IDs and metadata
 *
 * @module
 */

import type { PostgrestClient } from "./deps.js";
import type { Tracer } from "./tracer.js";

import { createSafeLogger } from '@aisha/security';
const log = createSafeLogger('svc-ai-chat');
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single session memory entry. */
export interface SessionMemoryEntry {
  key: string;
  value: Record<string, unknown>;
  expires_at: string | null;
}

/** A single long-term user memory entry. */
export interface UserMemoryEntry {
  key: string;
  value: Record<string, unknown>;
  confidence: number;
  source: string;
  last_updated: string;
}

/** Options for the memory manager. */
export interface MemoryManagerOptions {
  /** Conversation ID (required for session memory). */
  conversationId: string;
  /** User ID. */
  userId: string;
  /** Whether to load long-term memory at init. Default: true. */
  loadLongTermOnInit?: boolean;
  /** Default TTL for session memory entries (ms). Default: 1 hour. */
  defaultSessionTtlMs?: number;
}

/** The memory manager interface. */
export interface MemoryManager {
  // --- Session Memory ---

  /** Load all session memory for current conversation. */
  loadSessionMemory(): Promise<SessionMemoryEntry[]>;

  /** Get a specific session memory key. Returns null if not found. */
  getSessionKey(key: string): Record<string, unknown> | null;

  /** Set a session memory key. Optionally with TTL. */
  setSessionKey(key: string, value: Record<string, unknown>, ttlMs?: number): Promise<void>;

  /** Get all loaded session memory as a flat object. */
  getSessionSnapshot(): Record<string, Record<string, unknown>>;

  // --- Long-term Memory ---

  /** Load all long-term memory for user. */
  loadUserMemory(): Promise<UserMemoryEntry[]>;

  /** Get a specific long-term memory key. Returns null if not found. */
  getUserKey(key: string): UserMemoryEntry | null;

  /** Set a long-term memory key (via agent). */
  setUserKey(
    key: string,
    value: Record<string, unknown>,
    confidence?: number,
    source?: string,
  ): Promise<void>;

  /** Build a context summary for injection into the system prompt. */
  buildMemoryContext(): string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a memory manager for a chat session.
 *
 * Loads session + long-term memory from the database and provides
 * read/write operations with trace integration.
 */
export function createMemoryManager(
  pgrestService: PostgrestClient,
  tracer: Tracer,
  options: MemoryManagerOptions,
): MemoryManager {
  const {
    conversationId,
    userId,
    defaultSessionTtlMs = 60 * 60 * 1000, // 1 hour
  } = options;

  // In-memory caches
  const sessionCache = new Map<string, SessionMemoryEntry>();
  const userCache = new Map<string, UserMemoryEntry>();

  async function loadSessionMemory(): Promise<SessionMemoryEntry[]> {
    const t0 = Date.now();
    try {
      const { data, error } = await pgrestService.rpc("get_session_memory_for_agent", {
        p_conversation_id: conversationId,
        p_user_id: userId,
      });

      if (error) {
        log.safeError("[memory] Failed to load session memory:", error.message);
        return [];
      }

      const entries: SessionMemoryEntry[] = (Array.isArray(data) ? data : []).map(
        (row: Record<string, unknown>) => ({
          key: row.key as string,
          value: (row.value ?? {}) as Record<string, unknown>,
          expires_at: (row.expires_at ?? null) as string | null,
        }),
      );

      // Update cache
      sessionCache.clear();
      for (const entry of entries) {
        sessionCache.set(entry.key, entry);
      }

      await tracer.event(
        "memory_read",
        "memory_manager",
        "postgrest",
        "load_session_memory",
        "ok",
        Date.now() - t0,
        {
          responseSummary: {
            entries_loaded: entries.length,
            keys: entries.map((e) => e.key),
          },
        },
      );

      return entries;
    } catch (err) {
      log.safeError("[memory] loadSessionMemory exception:", err);
      await tracer.event(
        "memory_read",
        "memory_manager",
        "postgrest",
        "load_session_memory",
        "error",
        Date.now() - t0,
        {
          errorJson: { message: err instanceof Error ? err.message : String(err) },
        },
      );
      return [];
    }
  }

  function getSessionKey(key: string): Record<string, unknown> | null {
    const entry = sessionCache.get(key);
    return entry?.value ?? null;
  }

  async function setSessionKey(
    key: string,
    value: Record<string, unknown>,
    ttlMs?: number,
  ): Promise<void> {
    const expiresAt = ttlMs
      ? new Date(Date.now() + ttlMs).toISOString()
      : defaultSessionTtlMs
        ? new Date(Date.now() + defaultSessionTtlMs).toISOString()
        : null;

    const t0 = Date.now();
    try {
      const { error } = await pgrestService.rpc("set_session_memory_for_agent", {
        p_conversation_id: conversationId,
        p_expires_at: expiresAt,
      
        p_key: key,
        p_user_id: userId,
        p_value: value,});

      if (error) {
        log.safeError("[memory] Failed to set session memory:", error.message);
      } else {
        // Update local cache
        sessionCache.set(key, { key, value, expires_at: expiresAt });
      }

      await tracer.event(
        "memory_write",
        "memory_manager",
        "postgrest",
        "set_session_memory",
        error ? "error" : "ok",
        Date.now() - t0,
        {
          requestSummary: { key, has_ttl: !!expiresAt },
        },
      );
    } catch (err) {
      log.safeError("[memory] setSessionKey exception:", err);
    }
  }

  function getSessionSnapshot(): Record<string, Record<string, unknown>> {
    const snapshot: Record<string, Record<string, unknown>> = {};
    for (const [key, entry] of sessionCache) {
      snapshot[key] = entry.value;
    }
    return snapshot;
  }

  async function loadUserMemory(): Promise<UserMemoryEntry[]> {
    const t0 = Date.now();
    try {
      const { data, error } = await pgrestService.rpc("get_user_memory_for_agent", {
        p_user_id: userId,
      });

      if (error) {
        log.safeError("[memory] Failed to load user memory:", error.message);
        return [];
      }

      const entries: UserMemoryEntry[] = (Array.isArray(data) ? data : []).map(
        (row: Record<string, unknown>) => ({
          key: row.key as string,
          value: (row.value ?? {}) as Record<string, unknown>,
          confidence: (row.confidence ?? 1.0) as number,
          source: (row.source ?? "unknown") as string,
          last_updated: (row.last_updated ?? "") as string,
        }),
      );

      // Update cache
      userCache.clear();
      for (const entry of entries) {
        userCache.set(entry.key, entry);
      }

      await tracer.event(
        "memory_read",
        "memory_manager",
        "postgrest",
        "load_user_memory",
        "ok",
        Date.now() - t0,
        {
          responseSummary: {
            entries_loaded: entries.length,
            keys: entries.map((e) => e.key),
          },
        },
      );

      return entries;
    } catch (err) {
      log.safeError("[memory] loadUserMemory exception:", err);
      await tracer.event(
        "memory_read",
        "memory_manager",
        "postgrest",
        "load_user_memory",
        "error",
        Date.now() - t0,
        {
          errorJson: { message: err instanceof Error ? err.message : String(err) },
        },
      );
      return [];
    }
  }

  function getUserKey(key: string): UserMemoryEntry | null {
    return userCache.get(key) ?? null;
  }

  async function setUserKey(
    key: string,
    value: Record<string, unknown>,
    confidence = 0.8,
    source = "agent_derived",
  ): Promise<void> {
    const t0 = Date.now();
    try {
      const { error } = await pgrestService.rpc("set_user_memory_for_agent", {
        p_confidence: confidence,
      
        p_key: key,
        p_source: source,
        p_user_id: userId,
        p_value: value,});

      if (error) {
        log.safeError("[memory] Failed to set user memory:", error.message);
      } else {
        userCache.set(key, {
          key,
          value,
          confidence,
          source,
          last_updated: new Date().toISOString(),
        });
      }

      await tracer.event(
        "memory_write",
        "memory_manager",
        "postgrest",
        "set_user_memory",
        error ? "error" : "ok",
        Date.now() - t0,
        {
          requestSummary: { key, source, confidence },
        },
      );
    } catch (err) {
      log.safeError("[memory] setUserKey exception:", err);
    }
  }

  function buildMemoryContext(): string {
    const parts: string[] = [];

    // Session memory summary
    if (sessionCache.size > 0) {
      const sessionItems: string[] = [];
      for (const [key, entry] of sessionCache) {
        const summary = JSON.stringify(entry.value);
        // Truncate large values
        const truncated = summary.length > 200 ? summary.substring(0, 200) + "..." : summary;
        sessionItems.push(`- ${key}: ${truncated}`);
      }
      parts.push(`## Session Context (from earlier in this conversation)\n${sessionItems.join("\n")}`);
    }

    // Long-term memory summary
    if (userCache.size > 0) {
      const userItems: string[] = [];
      for (const [key, entry] of userCache) {
        if (entry.confidence >= 0.5) {
          const summary = JSON.stringify(entry.value);
          const truncated = summary.length > 200 ? summary.substring(0, 200) + "..." : summary;
          userItems.push(`- ${key} (confidence: ${(entry.confidence * 100).toFixed(0)}%): ${truncated}`);
        }
      }
      if (userItems.length > 0) {
        parts.push(`## User Preferences & Known Context\n${userItems.join("\n")}`);
      }
    }

    return parts.length > 0 ? "\n\n" + parts.join("\n\n") : "";
  }

  return {
    loadSessionMemory,
    getSessionKey,
    setSessionKey,
    getSessionSnapshot,
    loadUserMemory,
    getUserKey,
    setUserKey,
    buildMemoryContext,
  };
}
