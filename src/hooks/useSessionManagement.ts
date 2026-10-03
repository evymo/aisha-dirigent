import { useEffect, useCallback, useState } from 'react';
import { aisha } from '@/integrations/db/client';
import { useSession } from './useSession';
import { toast } from "sonner";
import { safeError } from "@/lib/security/safeLogger";
import { useIsMountedRef } from './useIsMountedRef';
import type { Database } from '@/integrations/db/types';
import {
  activeSessionArraySchema,
  parseArrayResponseSafe,
  type ActiveSessionRpc,
} from "@/lib/schemas/hookSchemas";

type SessionUpsertResult = Database["public"]["Functions"]["upsert_user_session"]["Returns"];

/**
 * Represents an active user session.
 */
export interface ActiveSession {
  id: string;
  user_id?: string;
  created_at: string;
  last_active_at: string;
  last_activity?: string; // Alias for last_active_at
  user_agent: string | null;
  ip_address?: string | null;
  session_token_hash?: string;
}

/**
 * Configuration options for session management.
 */
export interface SessionManagementConfig {
  /** Maximum number of concurrent sessions allowed (reserved for future use). */
  maxConcurrentSessions?: number;
  /** Whether to notify on new session creation (reserved for future use). */
  notifyOnNewSession?: boolean;
}

/**
 * Hook for managing user sessions.
 *
 * This hook handles session registration, activity updates, and retrieval of active sessions.
 * It also provides functionality to revoke sessions.
 *
 * @param config - Optional configuration for session management.
 * @returns Object containing active sessions, current session ID, and management functions.
 *
 * @example
 * const { activeSessions, revokeSession } = useSessionManagement();
 */
export function useSessionManagement({
  maxConcurrentSessions: _maxConcurrentSessions = 3,
  notifyOnNewSession: _notifyOnNewSession = true,
}: SessionManagementConfig = {}) {
  // Config params are reserved for future use
  void _maxConcurrentSessions;
  void _notifyOnNewSession;
  const { user, session } = useSession();
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const isMountedRef = useIsMountedRef();

  const registerSession = useCallback(async () => {
    if (!user || !session) return;

    if (typeof navigator === 'undefined') return;

    const sessionTokenHash = await hashToken(session.access_token.slice(-16));
    const userAgent = navigator.userAgent.slice(0, 255);

    const { data, error } = await aisha.rpc("upsert_user_session", {
      p_session_id: sessionTokenHash,
      p_user_agent: userAgent,
    });

    const dataArray = data as SessionUpsertResult | null;
    if (dataArray && Array.isArray(dataArray) && dataArray.length > 0) {
      if (isMountedRef.current) {
        setCurrentSessionId(dataArray[0].id);
      }
    }

    if (error && error.code !== '23505') {
      safeError('Failed to register session', error);
    }
  }, [user, session, isMountedRef]);

  const updateActivity = useCallback(async () => {
    if (!currentSessionId) return;

    await aisha.rpc("update_session_activity", {
      p_session_id: currentSessionId,
    });
  }, [currentSessionId]);

  const fetchActiveSessions = useCallback(async () => {
    if (!user) return;

    const { data, error } = await aisha.rpc("get_my_active_sessions");

    if (data && !error) {
      if (isMountedRef.current) {
        // Validate with Zod and map to ActiveSession interface
        const validated = parseArrayResponseSafe(
          activeSessionArraySchema,
          data,
          "get_my_active_sessions"
        );
        const sessions: ActiveSession[] = validated.map((s: ActiveSessionRpc) => ({
          id: s.id,
          created_at: s.created_at,
          last_active_at: s.last_active_at,
          last_activity: s.last_active_at,
          user_agent: s.user_agent,
          ip_address: s.ip_address,
        }));
        setActiveSessions(sessions);
      }
    }
  }, [user, isMountedRef]);

  const terminateSession = useCallback(async (sessionId: string) => {
    const { error } = await aisha.rpc("terminate_session", {
      p_session_id: sessionId,
    });

    if (!error) {
      if (isMountedRef.current) {
        setActiveSessions((prev) => prev.filter((s) => s.id !== sessionId));
        toast.success('Session Terminated', { description: 'The session has been logged out successfully.' });
      }
    }
  }, [isMountedRef]);

  const terminateOtherSessions = useCallback(async () => {
    if (!user || !currentSessionId) return;

    const { error } = await aisha.rpc("terminate_all_other_sessions");

    if (!error) {
      if (isMountedRef.current) {
        setActiveSessions((prev) => prev.filter((s) => s.id === currentSessionId));
        toast.success('Sessions Terminated', { description: 'All other sessions have been logged out.' });
      }
    }
  }, [user, currentSessionId, isMountedRef]);

  const cleanupSession = useCallback(async () => {
    if (!currentSessionId) return;

    await aisha.rpc("terminate_session", {
      p_session_id: currentSessionId,
    });
  }, [currentSessionId]);

  useEffect(() => {
    if (user && session) {
      registerSession();
    }
  }, [user, session, registerSession]);

  useEffect(() => {
    if (!currentSessionId) return;

    const interval = setInterval(updateActivity, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [currentSessionId, updateActivity]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    window.addEventListener('beforeunload', cleanupSession);
    return () => window.removeEventListener('beforeunload', cleanupSession);
  }, [cleanupSession]);

  return {
    activeSessions,
    currentSessionId,
    fetchActiveSessions,
    terminateSession,
    terminateOtherSessions,
    updateActivity,
  };
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 64);
}
