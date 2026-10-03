/**
 * Background sync service.
 * Uses expo-background-task for periodic data synchronization.
 */
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { safeError, safeInfo } from "@/lib/security/safeLogger";
import { processOfflineQueue } from "@/services/offline";

const TASK_NAME = "AISHA_BACKGROUND_SYNC";
const LAST_SYNC_KEY = "@aisha/last_bg_sync";
const SYNC_HISTORY_KEY = "@aisha/bg_sync_history";
const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_HISTORY_DAYS = 7;

export interface SyncHistoryEntry {
  failed: number;
  processed: number;
  status: "success" | "error" | "skipped";
  timestamp: number;
}

// Register background task (must be at module level)
TaskManager.defineTask(TASK_NAME, async () => {
  try {
    // Check minimum interval
    const lastSyncStr = await AsyncStorage.getItem(LAST_SYNC_KEY);
    const lastSync = lastSyncStr ? parseInt(lastSyncStr, 10) : 0;

    if (Date.now() - lastSync < MIN_INTERVAL_MS) {
      safeInfo("backgroundSync.skipped.tooRecent");
      await addHistoryEntry({ failed: 0, processed: 0, status: "skipped", timestamp: Date.now() });
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    // Process offline mutation queue
    const result = await processOfflineQueue();

    await AsyncStorage.setItem(LAST_SYNC_KEY, Date.now().toString());
    await addHistoryEntry({
      failed: result.failed,
      processed: result.processed,
      status: "success",
      timestamp: Date.now(),
    });

    safeInfo("backgroundSync.completed", result);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    safeError("backgroundSync.failed", error);
    await addHistoryEntry({ failed: 0, processed: 0, status: "error", timestamp: Date.now() });
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

async function addHistoryEntry(entry: SyncHistoryEntry): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(SYNC_HISTORY_KEY);
    const history: SyncHistoryEntry[] = raw ? JSON.parse(raw) : [];

    history.push(entry);

    // Keep only last 7 days
    const cutoff = Date.now() - MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000;
    const filtered = history.filter((e) => e.timestamp > cutoff);

    await AsyncStorage.setItem(SYNC_HISTORY_KEY, JSON.stringify(filtered));
  } catch (error) {
    safeError("backgroundSync.addHistory", error);
  }
}

export async function enableBackgroundSync(): Promise<boolean> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
      safeInfo("backgroundSync.restricted");
      return false;
    }

    await BackgroundTask.registerTaskAsync(TASK_NAME, {
      minimumInterval: 360, // 6 hours in minutes
    });

    safeInfo("backgroundSync.enabled");
    return true;
  } catch (error) {
    safeError("backgroundSync.enable.failed", error);
    return false;
  }
}

export async function disableBackgroundSync(): Promise<void> {
  try {
    await BackgroundTask.unregisterTaskAsync(TASK_NAME);
    safeInfo("backgroundSync.disabled");
  } catch (error) {
    safeError("backgroundSync.disable.failed", error);
  }
}

export async function getIsEnabled(): Promise<boolean> {
  return TaskManager.isTaskRegisteredAsync(TASK_NAME);
}

export async function getStatus(): Promise<{
  isAvailable: boolean;
  isEnabled: boolean;
  isRestricted: boolean;
}> {
  const bgStatus = await BackgroundTask.getStatusAsync();
  const isEnabled = await getIsEnabled();

  return {
    isAvailable: bgStatus === BackgroundTask.BackgroundTaskStatus.Available,
    isEnabled,
    isRestricted: bgStatus === BackgroundTask.BackgroundTaskStatus.Restricted,
  };
}

export async function getHistory(): Promise<SyncHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(SYNC_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function clearHistory(): Promise<void> {
  await AsyncStorage.removeItem(SYNC_HISTORY_KEY);
}
