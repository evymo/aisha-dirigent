import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import {
  parseRpcResponse,
  parseArrayResponse,
  shipmentSettingsSchema,
  distributionScheduleArraySchema,
  type ShipmentSettings,
  type DistributionSchedule,
} from "@/lib/schemas/adminSchemas";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { usePermissions } from "./usePermissions";
import { useSession } from "./useSession";

export type { ShipmentSettings, DistributionSchedule };

const DEFAULT_SETTINGS: ShipmentSettings = {
  auto_create_packeta: { enabled: false, delay_minutes: 0 },
  auto_ship_days: { enabled: false, days: ["monday", "wednesday", "friday"] },
  auto_ship_time: { time: "14:00", timezone: "Europe/Prague" },
  notification_email: { email: null, send_on_new_order: true, send_on_shipment: true },
  packeta_defaults: { default_weight: 0.5, default_value: 50, sender_name: "Platform" },
  shipping_rates: {
    base_currency: BASE_CURRENCY_FALLBACK,
    methods: {
      packeta_pickup: { default: 99, by_country: {} },
      packeta_home: { default: 149, by_country: {} },
      personal_pickup: { default: 0, by_country: {} },
    },
  },
};

export { DEFAULT_SETTINGS as DEFAULT_SHIPMENT_SETTINGS };

/**
 * Hook to fetch shipment settings using React Query.
 *
 * @returns Query result with shipment settings
 *
 * @example
 * const { data: settings, isLoading } = useShipmentSettings();
 */
export function useShipmentSettings() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["shipment-settings"],
    queryFn: async (): Promise<ShipmentSettings> => {
      const { data, error } = await aisha.rpc("get_shipment_settings");

      if (error) {
        safeError("useShipmentSettings.error", error);
        throw new Error(error.message);
      }

      if (data) {
        const validated = parseRpcResponse(shipmentSettingsSchema, data, "shipmentSettings");
        return {
          ...DEFAULT_SETTINGS,
          ...validated,
        } as ShipmentSettings;
      }
      return DEFAULT_SETTINGS;
    },
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook to fetch distribution schedules for a given month.
 *
 * @param selectedDate - The selected date to determine month range
 * @returns Query result with distribution schedules
 *
 * @example
 * const { data: schedules, isLoading } = useDistributionSchedules(new Date());
 */
export function useDistributionSchedules(selectedDate: Date) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  const fromDate = format(startOfMonth(selectedDate), "yyyy-MM-dd");
  const toDate = format(endOfMonth(selectedDate), "yyyy-MM-dd");

  return useQuery({
    queryKey: ["distribution-calendar", fromDate, toDate],
    queryFn: async (): Promise<DistributionSchedule[]> => {
      const { data, error } = await aisha.rpc("get_distribution_calendar_admin", {
        p_from: fromDate,
        p_to: toDate,
      });

      if (error) {
        safeError("useDistributionSchedules.error", error);
        throw new Error(error.message);
      }

      return parseArrayResponse(
        distributionScheduleArraySchema,
        data,
        "distributionSchedules"
      );
    },
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook to update a shipment setting.
 *
 * @returns Mutation for updating shipment settings
 *
 * @example
 * const updateSetting = useUpdateShipmentSetting();
 * await updateSetting.mutateAsync({ key: 'auto_ship_days', value: { enabled: true } });
 */
export function useUpdateShipmentSetting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      key,
      value,
    }: {
      key: string;
      value: unknown;
    }) => {
      const { error } = await aisha.rpc("update_shipment_setting", {
        p_key: key,
        p_value: JSON.stringify(value),
      });
      if (error) {
        safeError("useUpdateShipmentSetting.error", error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shipment-settings"] });
    },
  });
}

/**
 * Hook to save all shipment settings at once.
 *
 * @returns Mutation for saving all settings
 *
 * @example
 * const saveSettings = useSaveShipmentSettings();
 * await saveSettings.mutateAsync(settings);
 */
export function useSaveShipmentSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (settings: ShipmentSettings) => {
      for (const [key, value] of Object.entries(settings)) {
        const { error } = await aisha.rpc("update_shipment_setting", {
          p_key: key,
          p_value: JSON.stringify(value),
        });
        if (error) {
          safeError("useSaveShipmentSettings.error", error);
          throw new Error(error.message);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shipment-settings"] });
    },
  });
}

/**
 * Hook to create a distribution schedule.
 *
 * @returns Mutation for creating distribution schedules
 *
 * @example
 * const createSchedule = useCreateDistributionSchedule();
 * await createSchedule.mutateAsync({ scheduledDate: '2026-02-15', scheduledTime: '14:00' });
 */
export function useCreateDistributionSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      scheduledDate,
      scheduledTime,
    }: {
      scheduledDate: string;
      scheduledTime: string;
    }) => {
      const { error } = await aisha.rpc("create_distribution_schedule_admin", {
        p_scheduled_date: scheduledDate,
        p_scheduled_time: scheduledTime,
      });
      if (error) {
        safeError("useCreateDistributionSchedule.error", error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distribution-calendar"] });
    },
  });
}

/**
 * Hook to process a distribution schedule.
 *
 * @returns Mutation for processing distribution schedules
 *
 * @example
 * const processSchedule = useProcessDistributionSchedule();
 * const result = await processSchedule.mutateAsync('schedule-id');
 */
export function useProcessDistributionSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (scheduleId: string): Promise<{ processed: number }> => {
      const { data, error } = await aisha.rpc("process_distribution_schedule", {
        p_schedule_id: scheduleId,
      });
      if (error) {
        safeError("useProcessDistributionSchedule.error", error);
        throw new Error(error.message);
      }
      return data as { processed: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distribution-calendar"] });
    },
  });
}
