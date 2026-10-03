/**
 * Mobile hook for Matrix client initialization via Supabase → Matrix token exchange.
 *
 * Exchanges the current Supabase JWT for a Matrix access token using the
 * `matrix-token-exchange` edge function, provides connection state
 * for future matrix-js-sdk integration.
 *
 * @module hooks/useMatrixClient
 */

import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/config/api";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";

// =============================================================================
// Schemas
// =============================================================================

const matrixTokenSchema = z.object({
  access_token: z.string(),
  user_id: z.string(),
  home_server: z.string(),
});

// =============================================================================
// Types
// =============================================================================

export type MatrixConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface MatrixCredentials {
  accessToken: string;
  userId: string;
  homeServer: string;
}

// =============================================================================
// Keys
// =============================================================================

export const matrixKeys = {
  all: ["matrix"] as const,
  token: (userId: string) => [...matrixKeys.all, "token", userId] as const,
  rooms: (userId: string) => [...matrixKeys.all, "rooms", userId] as const,
  messages: (roomId: string) => [...matrixKeys.all, "messages", roomId] as const,
};

// =============================================================================
// Hook
// =============================================================================

export function useMatrixClient(userId: string | undefined) {
  const [status, setStatus] = useState<MatrixConnectionStatus>("disconnected");
  const [credentials, setCredentials] = useState<MatrixCredentials | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ─── Token exchange query ──────────────────────────────────
  const tokenQuery = useQuery({
    queryKey: matrixKeys.token(userId ?? ""),
    queryFn: async () => {
      const { data, error: fnError } = await api.invoke(
        "matrix-token-exchange",
        { body: {} }
      );

      if (fnError) throw fnError;

      const parsed = matrixTokenSchema.parse(data);
      return {
        accessToken: parsed.access_token,
        userId: parsed.user_id,
        homeServer: parsed.home_server,
      } satisfies MatrixCredentials;
    },
    enabled: !!userId,
    staleTime: 30 * 60 * 1000, // 30min — Matrix tokens are long-lived
    retry: 1,
  });

  // ─── Update credentials when token arrives ─────────────────
  useEffect(() => {
    if (tokenQuery.data) {
      setCredentials(tokenQuery.data);
      setStatus("connected");
      setError(null);
    } else if (tokenQuery.isError) {
      setStatus("error");
      setError(tokenQuery.error?.message ?? "Matrix token exchange failed");
      safeError("matrixClient.tokenExchange", tokenQuery.error);
    } else if (tokenQuery.isFetching) {
      setStatus("connecting");
    }
  }, [tokenQuery.data, tokenQuery.isError, tokenQuery.isFetching, tokenQuery.error]);

  // ─── Reconnect ─────────────────────────────────────────────
  const reconnect = useCallback(() => {
    setStatus("connecting");
    setError(null);
    tokenQuery.refetch();
  }, [tokenQuery]);

  // ─── Disconnect ────────────────────────────────────────────
  const disconnect = useCallback(() => {
    setCredentials(null);
    setStatus("disconnected");
    setError(null);
  }, []);

  return {
    status,
    credentials,
    error,
    reconnect,
    disconnect,
    isConnected: status === "connected",
    matrixUserId: credentials?.userId ?? null,
    homeServer: credentials?.homeServer ?? null,
  };
}
