import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/config/api";
import { notificationSchema } from "@/types/schemas";
import { safeError } from "@/lib/security/safeLogger";
import type { Notification } from "@/types/schemas";

function parseNotifications(data: unknown): Notification[] {
  if (!Array.isArray(data)) return [];
  return data.reduce<Notification[]>((acc, item) => {
    const result = notificationSchema.safeParse(item);
    if (result.success) acc.push(result.data);
    return acc;
  }, []);
}

export function useInAppNotifications(userId: string | undefined) {
  return useQuery({
    queryKey: ["notifications", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_notifications", {
        p_limit: 50,
      });
      if (error) {
        safeError("useInAppNotifications.fetch", error);
        throw error;
      }
      return parseNotifications(data);
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
}

export function useUnreadNotificationCount(userId: string | undefined) {
  return useQuery<number>({
    queryKey: ["unread-notification-count", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_unread_notification_count");
      if (error) {
        safeError("useUnreadNotificationCount.fetch", error);
        throw error;
      }
      return typeof data === "number" ? data : 0;
    },
    enabled: !!userId,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await api.rpc("mark_notification_read", {
        p_notification_id: notificationId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["unread-notification-count"] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await api.rpc("mark_all_notifications_read");
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["unread-notification-count"] });
    },
  });
}
