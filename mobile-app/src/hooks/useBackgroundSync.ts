/**
 * Background sync hook.
 * Manages expo-background-task registration and sync history.
 */
import { useCallback, useEffect, useState } from "react";
import {
  clearHistory,
  disableBackgroundSync,
  enableBackgroundSync,
  getHistory,
  getStatus,
  type SyncHistoryEntry,
} from "@/services/background";
import { safeError } from "@/lib/security/safeLogger";

interface BackgroundSyncState {
  history: SyncHistoryEntry[];
  isAvailable: boolean;
  isEnabled: boolean;
  isRestricted: boolean;
}

export function useBackgroundSync() {
  const [state, setState] = useState<BackgroundSyncState>({
    history: [],
    isAvailable: false,
    isEnabled: false,
    isRestricted: false,
  });

  const refresh = useCallback(async () => {
    try {
      const [status, history] = await Promise.all([getStatus(), getHistory()]);
      setState({ ...status, history });
    } catch (error) {
      safeError("useBackgroundSync.refresh", error);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const enable = useCallback(async (): Promise<boolean> => {
    const result = await enableBackgroundSync();
    await refresh();
    return result;
  }, [refresh]);

  const disable = useCallback(async () => {
    await disableBackgroundSync();
    await refresh();
  }, [refresh]);

  const handleClearHistory = useCallback(async () => {
    await clearHistory();
    await refresh();
  }, [refresh]);

  return {
    ...state,
    clearHistory: handleClearHistory,
    disable,
    enable,
    refresh,
  };
}
