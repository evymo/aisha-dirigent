import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useSession } from "@/hooks/useSession";
import type { Json } from "@/integrations/db/types";

export const WEB_PUSH_SUBSCRIPTIONS_QUERY_KEY = ["web-push-subscriptions"] as const;

const webPushSubscriptionRowSchema = z.object({
  id: z.string().uuid(),
  endpoint: z.string().min(1),
  is_active: z.boolean(),
  expiration_time: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  last_seen_at: z.string(),
});

const webPushSubscriptionArraySchema = z.array(webPushSubscriptionRowSchema);

export type WebPushSubscriptionRow = z.infer<typeof webPushSubscriptionRowSchema>;
const EMPTY_SUBSCRIPTIONS: WebPushSubscriptionRow[] = [];

const getBrowserPermissionState = (): NotificationPermission | "unsupported" => {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
};

const urlBase64ToUint8Array = (base64UrlString: string): Uint8Array<ArrayBuffer> => {
  const padding = "=".repeat((4 - (base64UrlString.length % 4)) % 4);
  const base64 = (base64UrlString + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
};

const encodeArrayBufferToBase64Url = (value: ArrayBuffer | null): string | null => {
  if (!value) return null;

  const bytes = new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const serializePushSubscription = (
  subscription: PushSubscription
): Json | null => {
  const p256dh = encodeArrayBufferToBase64Url(subscription.getKey("p256dh"));
  const auth = encodeArrayBufferToBase64Url(subscription.getKey("auth"));

  if (!p256dh || !auth) return null;

  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: {
      p256dh,
      auth,
    },
    userAgent: navigator.userAgent,
    locale: navigator.language || "en",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
};

/**
 * Manages browser Web Push subscription lifecycle for the current user.
 */
export function useWebPushSubscription(options?: {
  enabled?: boolean;
  autoSync?: boolean;
  autoSubscribeWhenGranted?: boolean;
}) {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    getBrowserPermissionState
  );
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null);

  const enabled = options?.enabled ?? true;
  const autoSync = options?.autoSync ?? false;
  const autoSubscribeWhenGranted = options?.autoSubscribeWhenGranted ?? false;

  const browserPushSupported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  const vapidPublicKey = import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? "";
  const vapidConfigured = vapidPublicKey.length > 0;

  const query = useQuery({
    queryKey: WEB_PUSH_SUBSCRIPTIONS_QUERY_KEY,
    enabled: enabled && Boolean(user?.id),
    staleTime: 30_000,
    queryFn: async (): Promise<WebPushSubscriptionRow[]> => {
      const { data, error } = await aisha.rpc("get_my_web_push_subscriptions");
      if (error) {
        safeError("useWebPushSubscription.fetch", error);
        throw new Error(error.message);
      }

      const parsed = webPushSubscriptionArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("useWebPushSubscription.parse", parsed.error);
        return [];
      }

      return parsed.data;
    },
  });

  const refreshCurrentEndpoint = useCallback(async (): Promise<string | null> => {
    if (!browserPushSupported || !user?.id) {
      setCurrentEndpoint(null);
      return null;
    }

    setPermission(getBrowserPermissionState());

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const endpoint = subscription?.endpoint ?? null;
      setCurrentEndpoint(endpoint);
      return endpoint;
    } catch (error) {
      safeError("useWebPushSubscription.endpoint", error);
      setCurrentEndpoint(null);
      return null;
    }
  }, [browserPushSupported, user?.id]);

  const syncMutation = useMutation({
    mutationFn: async (): Promise<string | null> => {
      if (!browserPushSupported || !user?.id) return null;

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        setCurrentEndpoint(null);
        return null;
      }

      const payload = serializePushSubscription(subscription);
      if (!payload) {
        throw new Error("Invalid PushSubscription keys");
      }

      const { error } = await aisha.rpc("upsert_web_push_subscription", {
        p_subscription: payload,
      });
      if (error) {
        safeError("useWebPushSubscription.sync", error);
        throw new Error(error.message);
      }

      setCurrentEndpoint(subscription.endpoint);
      return subscription.endpoint;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WEB_PUSH_SUBSCRIPTIONS_QUERY_KEY });
    },
  });

  const enableMutation = useMutation({
    mutationFn: async (): Promise<string> => {
      if (!browserPushSupported) {
        throw new Error("Browser Push API is not supported");
      }
      if (!vapidConfigured) {
        throw new Error("Missing VAPID public key");
      }

      let permissionState = getBrowserPermissionState();
      if (permissionState !== "granted") {
        permissionState = await Notification.requestPermission();
      }
      setPermission(permissionState);
      if (permissionState !== "granted") {
        throw new Error("Notification permission not granted");
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
      }

      const payload = serializePushSubscription(subscription);
      if (!payload) {
        throw new Error("Invalid PushSubscription keys");
      }

      const { error } = await aisha.rpc("upsert_web_push_subscription", {
        p_subscription: payload,
      });
      if (error) {
        safeError("useWebPushSubscription.enable", error);
        throw new Error(error.message);
      }

      setCurrentEndpoint(subscription.endpoint);
      return subscription.endpoint;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WEB_PUSH_SUBSCRIPTIONS_QUERY_KEY });
    },
  });

  const disableMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      if (!browserPushSupported) return;

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const { error } = await aisha.rpc("delete_web_push_subscription", {
          p_endpoint: subscription.endpoint,
        });
        if (error) {
          safeError("useWebPushSubscription.disable", error);
          throw new Error(error.message);
        }

        await subscription.unsubscribe();
      } else {
        const { error } = await aisha.rpc("delete_web_push_subscription", {});
        if (error) {
          safeError("useWebPushSubscription.disableAll", error);
          throw new Error(error.message);
        }
      }

      setCurrentEndpoint(null);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WEB_PUSH_SUBSCRIPTIONS_QUERY_KEY });
    },
  });

  useEffect(() => {
    if (!enabled || !user?.id) return;
    if (!browserPushSupported) return;

    void refreshCurrentEndpoint();
  }, [browserPushSupported, enabled, refreshCurrentEndpoint, user?.id]);

  // Stable refs to avoid re-triggering the auto-sync effect when mutation
  // objects change identity (they are recreated every render by useMutation).
  const syncRef = useRef(syncMutation);
  syncRef.current = syncMutation;

  const enableRef = useRef(enableMutation);
  enableRef.current = enableMutation;

  // Guard: run the auto-sync at most once per mount / dependency change
  const autoSyncRunningRef = useRef(false);

  useEffect(() => {
    if (!enabled || !user?.id || !browserPushSupported) return;
    if (!autoSync) return;
    if (permission !== "granted") return;

    // Prevent concurrent / re-entrant runs caused by query invalidation
    if (autoSyncRunningRef.current) return;

    let cancelled = false;

    const run = async () => {
      autoSyncRunningRef.current = true;
      try {
        const endpoint = await refreshCurrentEndpoint();
        if (cancelled) return;

        if (endpoint) {
          await syncRef.current.mutateAsync();
          return;
        }

        if (autoSubscribeWhenGranted && vapidConfigured) {
          await enableRef.current.mutateAsync();
        }
      } finally {
        autoSyncRunningRef.current = false;
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    autoSubscribeWhenGranted,
    autoSync,
    browserPushSupported,
    enabled,
    permission,
    refreshCurrentEndpoint,
    user?.id,
    vapidConfigured,
  ]);

  const subscriptions = query.data ?? EMPTY_SUBSCRIPTIONS;
  const activeSubscriptionCount = subscriptions.filter((item) => item.is_active).length;

  const isCurrentBrowserSubscribed = useMemo(() => {
    if (!currentEndpoint) return false;
    return subscriptions.some(
      (item) => item.is_active && item.endpoint === currentEndpoint
    );
  }, [currentEndpoint, subscriptions]);

  return {
    browserPushSupported,
    vapidConfigured,
    permission,
    subscriptions,
    activeSubscriptionCount,
    currentEndpoint,
    isCurrentBrowserSubscribed,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isSyncing: syncMutation.isPending,
    isEnabling: enableMutation.isPending,
    isDisabling: disableMutation.isPending,
    syncSubscription: syncMutation.mutateAsync,
    enableWebPush: enableMutation.mutateAsync,
    disableWebPush: disableMutation.mutateAsync,
    refresh: query.refetch,
  };
}
