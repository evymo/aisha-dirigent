import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import {
  knockDeviceAdminArraySchema,
  parseArrayResponse,
  type KnockDeviceAdminRow,
} from "@/lib/schemas/adminSchemas";

const QUERY_KEY = "admin-knock-devices";

export type KnockDeviceStatus = "pending" | "approved" | "revoked";

/**
 * Stav průkazu zařízení.
 *
 * Odvolání má přednost: `admin_set_knock_device_approval` při odvolání
 * schválení nuluje, ale kdyby se oba údaje v datech potkaly, zařízení se
 * dveřmi pustit nesmí — „schváleno" by tu byla ta nebezpečnější lež.
 */
export function knockDeviceStatus(
  device: Pick<KnockDeviceAdminRow, "approved_at" | "revoked_at">,
): KnockDeviceStatus {
  if (device.revoked_at) return "revoked";
  if (device.approved_at) return "approved";
  return "pending";
}

/**
 * Průkazy zařízení pro správu v administraci.
 *
 * @param userId - Jen zařízení, která uživatel zavedl NEBO používá; bez něj všechna.
 */
export function useKnockDevicesAdmin(userId?: string | null) {
  const { guardAdminRead } = useAdminGuard();

  const fetchDevices = guardAdminRead(
    "admin_list_knock_devices",
    async (): Promise<KnockDeviceAdminRow[]> => {
      const { data, error } = await aisha.rpc(
        "admin_list_knock_devices",
        userId ? { p_user_id: userId } : {},
      );
      if (error) {
        safeError("adminKnockDevices.list.failed", error);
        throw new Error(error.message);
      }
      return parseArrayResponse(knockDeviceAdminArraySchema, data, "adminKnockDevices");
    },
  );

  return useQuery({
    queryKey: [QUERY_KEY, userId ?? null],
    queryFn: fetchDevices,
    staleTime: 30_000,
  });
}

export interface KnockDeviceApprovalInput {
  approved: boolean;
  kid: string;
}

/**
 * Schválí nebo odvolá průkaz. Jediné místo, kde se o vstupu zařízení rozhoduje;
 * odvolání záznam nemaže (audit a historie zůstávají).
 */
export function useSetKnockDeviceApproval() {
  const { guardAdminMutation } = useAdminGuard();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: guardAdminMutation(
      "admin_set_knock_device_approval",
      async ({ approved, kid }: KnockDeviceApprovalInput): Promise<void> => {
        const { error } = await aisha.rpc("admin_set_knock_device_approval", {
          p_approved: approved,
          p_kid: kid,
        });
        if (error) {
          safeError("adminKnockDevices.approval.failed", error);
          throw new Error(error.message);
        }
      },
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });
}
