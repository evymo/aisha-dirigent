/**
 * Offline support hook.
 * Monitors connectivity, processes mutation queue on reconnect,
 * persists query cache for offline access.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearQueue,
  type FailureKind,
  getNeedsAttentionCount,
  getQueueSize,
  processOfflineQueue,
  registerDefaultMutationHandlers,
  subscribeToNetworkChanges,
} from "@/services/offline";
import { safeError, safeInfo } from "@/lib/security/safeLogger";

interface OfflineState {
  isConnected: boolean;
  isProcessing: boolean;
  lastSyncAt: number | null;
  queueSize: number;
  /**
   * Kolik položek vyčerpalo pokusy a čeká na člověka. NEJSOU ztracené — pořád
   * jsou ve frontě; jen se samy neodešlou.
   */
  needsAttention: number;
  /**
   * Proč se poslední běh zastavil, nebo `null` když doběhl celý.
   *
   * ⭐ Tohle je rozdíl, kvůli kterému to tu je: `unreachable` znamená „nemáme
   * signál" — počká se a nic se uživateli nenabízí. `denied` znamená „spojení
   * máme, ale protistrana nás odmítá" — a to je JEDINÝ stav, ve kterém má smysl
   * nabídnout zaklepání. Bez rozlišení by aplikace chtěla kód i v tunelu a
   * naučila lidi psát break-glass materiál rutinně.
   */
  stoppedBy: FailureKind | "unreadable-store" | null;
  /**
   * ⛔ Trezor nejde otevřít — NEVÍME, co ve frontě je.
   *
   * Je to vlastní příznak, a ne `queueSize: 0`, protože nula je TVRZENÍ („nic
   * tam není") a tohle je jeho opak („nevím"). Badge s nulou nad podepsaným
   * předáním, které jen nejde přečíst, je přesně ta lež, kvůli které se celá
   * tahle vrstva psala.
   *
   * Příčina bývá dočasná (jiný profil, klíč po obnově systému), a proto se
   * úložiště v tomhle stavu NIČÍM nepřepisuje.
   */
  storeUnreadable: boolean;
}

export function useOffline() {
  const [state, setState] = useState<OfflineState>({
    isConnected: true,
    isProcessing: false,
    lastSyncAt: null,
    needsAttention: 0,
    queueSize: 0,
    stoppedBy: null,
    storeUnreadable: false,
  });
  const wasOffline = useRef(false);

  // Refresh queue size
  const refreshQueueSize = useCallback(async () => {
    try {
      const [size, attention] = await Promise.all([getQueueSize(), getNeedsAttentionCount()]);
      setState((prev) => ({ ...prev, needsAttention: attention, queueSize: size, storeUnreadable: false }));
    } catch (error) {
      // ⛔ Počítadla se NENULUJÍ. Poslední známá hodnota je pořád bližší pravdě
      // než nula, a `storeUnreadable` říká, že jistá není ani ona.
      safeError("useOffline.queueUnreadable", error);
      setState((prev) => ({ ...prev, storeUnreadable: true }));
    }
  }, []);

  // Process queue manually
  const processQueue = useCallback(async () => {
    setState((prev) => ({ ...prev, isProcessing: true }));
    try {
      const result = await processOfflineQueue();
      safeInfo("useOffline.processed", result);
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        // `lastSyncAt` smí posunout jen běh, který DOBĚHL. Zastavený běh nic
        // nesrovnal, a razítko „naposledy synchronizováno" by tvrdilo opak.
        ...(result.stoppedBy ? {} : { lastSyncAt: Date.now() }),
        stoppedBy: result.stoppedBy,
        storeUnreadable: result.stoppedBy === "unreadable-store",
      }));
      await refreshQueueSize();
      return result;
    } catch (error) {
      safeError("useOffline.processFailed", error);
      setState((prev) => ({ ...prev, isProcessing: false }));
      return { cizi: 0, drzene: 0, failed: 0, needsAttention: 0, processed: 0, stoppedBy: null };
    }
  }, [refreshQueueSize]);

  // Network state listener
  useEffect(() => {
    registerDefaultMutationHandlers();
    const unsubscribe = subscribeToNetworkChanges(async (isConnected) => {
      setState((prev) => ({ ...prev, isConnected }));

      // Auto-process queue when coming back online
      if (isConnected && wasOffline.current) {
        safeInfo("useOffline.reconnected");
        await processQueue();
      }
      wasOffline.current = !isConnected;
    });

    // Initial queue size
    refreshQueueSize();

    return unsubscribe;
  }, [processQueue, refreshQueueSize]);

  const handleClearQueue = useCallback(async () => {
    await clearQueue();
    await refreshQueueSize();
  }, [refreshQueueSize]);

  return {
    ...state,
    clearQueue: handleClearQueue,
    processQueue,
    refreshQueueSize,
  };
}
