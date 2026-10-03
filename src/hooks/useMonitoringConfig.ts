/**
 * Monitoring configuration hooks for system health monitors.
 *
 * Uses `system_config` table to persist monitoring preferences:
 * - `monitoring_health_enabled` → boolean (on/off)
 * - `monitoring_health_interval` → number (minutes, legacy — event-driven now)
 *
 * The n8n Health Monitor workflow (WF_ADMIN_HEALTH_MONITOR) uses an
 * **event-driven architecture**: lightweight local checks every 5 min,
 * but LLM/Dirigent webhooks fire ONLY on actual state transitions.
 * Config Gate reads `health_enabled` — when false, pipeline stops.
 * The interval setting is preserved for future use but the core
 * cost-saving comes from the State Change Detector, not polling interval.
 *
 * @module hooks/useMonitoringConfig
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { usePermissions } from "@/hooks/usePermissions";
import { safeError } from "@/lib/security/safeLogger";

// ============================================================================
// Schema & Types
// ============================================================================

const MonitoringConfigSchema = z.object({
  health_enabled: z.boolean(),
  health_interval_minutes: z.number().min(5).max(1440),
});

/** Monitoring configuration shape. */
export type MonitoringConfig = z.infer<typeof MonitoringConfigSchema>;

/** Predefined interval options in minutes. */
export const INTERVAL_OPTIONS = [
  { value: 5, label: "5 min" },
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 h" },
  { value: 360, label: "6 h" },
  { value: 1440, label: "24 h" },
] as const;

/** Default monitoring config when no DB record exists. */
export const DEFAULT_MONITORING_CONFIG: MonitoringConfig = {
  health_enabled: true,
  health_interval_minutes: 60,
};

// ============================================================================
// Normalize helper
// ============================================================================

function normalizeConfig(raw: unknown): MonitoringConfig {
  if (raw == null || typeof raw !== "object") return DEFAULT_MONITORING_CONFIG;

  const parsed = MonitoringConfigSchema.partial().safeParse(raw);
  if (parsed.success) {
    return { ...DEFAULT_MONITORING_CONFIG, ...parsed.data };
  }
  return DEFAULT_MONITORING_CONFIG;
}

// ============================================================================
// Query Keys
// ============================================================================

export const monitoringConfigKeys = {
  all: ["system-config", "monitoring"] as const,
};

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch monitoring configuration from system_config.
 *
 * @returns Query with monitoring configuration.
 * @example
 * const { data: config } = useMonitoringConfig();
 * config?.health_enabled // true/false
 * config?.health_interval_minutes // 60
 */
export function useMonitoringConfig() {
  const { hasPermission } = usePermissions();

  return useQuery({
    queryKey: monitoringConfigKeys.all,
    queryFn: async (): Promise<MonitoringConfig> => {
      try {
        const { data, error } = await aisha.rpc("get_system_config", {
          p_key: "monitoring_config",
        });

        if (error) {
          safeError("monitoringConfig.fetch", error);
          return DEFAULT_MONITORING_CONFIG;
        }

        return normalizeConfig(data);
      } catch (err) {
        safeError("monitoringConfig.fetch", err);
        return DEFAULT_MONITORING_CONFIG;
      }
    },
    enabled: hasPermission("view_admin_dashboard"),
    staleTime: 30_000,
  });
}

/**
 * Update monitoring configuration via admin RPC.
 *
 * Persists the full monitoring config object to `system_config`
 * under key `monitoring_config`, category `monitoring`.
 *
 * @returns Mutation for updating monitoring configuration.
 * @example
 * const { mutateAsync: update } = useUpdateMonitoringConfig();
 * await update({ health_enabled: false, health_interval_minutes: 60 });
 */
export function useUpdateMonitoringConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (config: MonitoringConfig): Promise<void> => {
      const { error } = await aisha.rpc("set_system_config_admin", {
        p_category: "monitoring",
        p_description:
          "Health monitoring configuration — toggle and interval for system health checks",
        p_is_public: false,
        p_key: "monitoring_config",
        p_value: config,
      });

      if (error) {
        safeError("monitoringConfig.update", error as Error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: monitoringConfigKeys.all,
      });
    },
  });
}
