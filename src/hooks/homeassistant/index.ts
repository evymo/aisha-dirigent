import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchHomeAssistantHealth,
  fetchHomeAssistantSyncProfile,
  fetchHomeAssistantSyncProfileStore,
  fetchHomeAssistantSyncProfileStoreSnapshot,
  saveHomeAssistantSyncProfile,
  saveHomeAssistantSyncProfileStore,
  syncHomeAssistantProductionData,
} from "./haApi";

// Re-export schemas, types, interfaces
export type {
  HomeAssistantEntityLink,
  HomeAssistantHealth,
  HomeAssistantProductionSyncInput,
  HomeAssistantProductionSyncProfile,
  HomeAssistantProductionSyncResult,
  HomeAssistantSyncProfileStore,
  HomeAssistantSyncProfileStoreSnapshot,
  HomeAssistantSyncProfileTemplate,
  HomeAssistantThreshold,
  SaveHomeAssistantSyncProfileStoreInput,
} from "./haSchemas";

// Re-export API functions
export {
  fetchHomeAssistantHealth,
  fetchHomeAssistantSyncProfile,
  fetchHomeAssistantSyncProfileStore,
  fetchHomeAssistantSyncProfileStoreSnapshot,
  saveHomeAssistantSyncProfile,
  saveHomeAssistantSyncProfileStore,
  syncHomeAssistantProductionData,
};

/**
 * Query hook for persisted Home Assistant sync profile.
 *
 * @param enabled - Optional toggle for lazy loading.
 * @returns React Query state with saved profile data.
 */
export function useHomeAssistantSyncProfile(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["homeassistant", "sync-profile"],
    queryFn: fetchHomeAssistantSyncProfile,
    staleTime: 60 * 1000,
  });
}

/**
 * Query hook for persisted Home Assistant sync profile store.
 *
 * @param enabled - Optional toggle for lazy loading.
 * @returns React Query state with saved profile templates and active profile.
 */
export function useHomeAssistantSyncProfileStore(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["homeassistant", "sync-profile-store"],
    queryFn: fetchHomeAssistantSyncProfileStore,
    staleTime: 60 * 1000,
  });
}

/**
 * Query hook for persisted Home Assistant sync profile store snapshot.
 *
 * @param enabled - Optional toggle for lazy loading.
 * @returns React Query state with store and CAS timestamp.
 */
export function useHomeAssistantSyncProfileStoreSnapshot(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["homeassistant", "sync-profile-store-snapshot"],
    queryFn: fetchHomeAssistantSyncProfileStoreSnapshot,
    staleTime: 60 * 1000,
  });
}

/**
 * Query hook for Home Assistant connectivity and configuration status.
 *
 * @param enabled - Optional toggle for lazy checks.
 * @returns React Query state for Home Assistant health.
 */
export function useHomeAssistantHealthCheck(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["homeassistant", "health"],
    queryFn: fetchHomeAssistantHealth,
    staleTime: 60 * 1000,
  });
}

/**
 * Mutation hook for syncing Home Assistant states into production sensor records.
 *
 * @returns React Query mutation for triggering Home Assistant sync.
 */
export function useHomeAssistantProductionSync() {
  return useMutation({
    mutationFn: syncHomeAssistantProductionData,
  });
}

/**
 * Mutation hook for persisting Home Assistant sync profile in system config.
 *
 * @returns React Query mutation for saving profile.
 */
export function useSaveHomeAssistantSyncProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: saveHomeAssistantSyncProfile,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["homeassistant", "sync-profile"] });
      void queryClient.invalidateQueries({
        queryKey: ["homeassistant", "sync-profile-store"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["homeassistant", "sync-profile-store-snapshot"],
      });
    },
  });
}

/**
 * Mutation hook for persisting Home Assistant sync profile store in system config.
 *
 * @returns React Query mutation for saving profile templates.
 */
export function useSaveHomeAssistantSyncProfileStore() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: saveHomeAssistantSyncProfileStore,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["homeassistant", "sync-profile"] });
      void queryClient.invalidateQueries({
        queryKey: ["homeassistant", "sync-profile-store"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["homeassistant", "sync-profile-store-snapshot"],
      });
    },
  });
}
