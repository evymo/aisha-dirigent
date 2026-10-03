/**
 * Push notifications hook — Firebase Cloud Messaging registration and handling.
 */
import { useCallback, useEffect, useState } from "react";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { api } from "@/config/api";
import { isLoggedIn } from "@/config/oidc";
import { safeError, safeInfo } from "@/lib/security/safeLogger";
import { nativeZarizeni } from "@/lib/knock-native";
import { ohlasZarizeni } from "@/lib/ohlaseniZarizeni";

type NotificationPayload = {
  notification?: {
    title?: string | null;
  } | null;
  data?: Record<string, unknown> | null;
};

type MessagingClient = {
  getInitialNotification: () => Promise<NotificationPayload | null>;
  getToken: () => Promise<string>;
  hasPermission: () => Promise<number>;
  onMessage: (listener: (message: NotificationPayload) => Promise<void>) => () => void;
  onTokenRefresh: (listener: (token: string) => Promise<void>) => () => void;
  requestPermission: () => Promise<number>;
};

/** Lazy-load Firebase to avoid init errors when services are missing */
async function getMessaging(): Promise<MessagingClient> {
  const messaging = await import("@react-native-firebase/messaging");
  return messaging.default() as MessagingClient;
}

const PUSH_DEVICE_ID_KEY = "aisha_push_device_id";

type PushSessionContext = {
  deviceId: string;
  fcmToken?: string;
};

function createFallbackDeviceId(): string {
  return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function getOrCreatePushDeviceId(): Promise<string> {
  try {
    const stored = await SecureStore.getItemAsync(PUSH_DEVICE_ID_KEY);
    if (stored && stored.length > 0) return stored;
  } catch {
    // fall through to create an identifier
  }

  const next = createFallbackDeviceId();

  try {
    await SecureStore.setItemAsync(PUSH_DEVICE_ID_KEY, next);
  } catch {
    // If secure storage fails we can still continue with in-memory value.
  }

  return next;
}

function getDeviceMetadata() {
  const appVersion = Constants.expoConfig?.version ?? undefined;
  const deviceModel = Device.modelName ?? Device.modelId ?? undefined;
  const platform = Platform.OS;
  const platformLabel = platform === "ios" ? "ios" : platform === "android" ? "android" : "unknown";
  const systemVersion = Device.osVersion ?? undefined;

  return {
    appVersion,
    deviceModel,
    platformLabel,
    systemVersion,
  };
}

async function withAuthenticatedUser<T>(operation: () => Promise<T>): Promise<T | null> {
  const loggedIn = await isLoggedIn();
  if (!loggedIn) return null;
  return operation();
}

/**
 * Ohlásí průkaz zařízení backendu, aby ho měl správce co schválit.
 *
 * ⭐ KOŘEN DŮVĚRY JE RUČNÍ ZAKLEPÁNÍ. Teprve otevřenými dveřmi se dá přihlásit
 * a přihlášení nese identitu — otisk tedy dorazí správci i s tím, komu patří,
 * aniž by uživatel cokoli opisoval (zadání majitele 2026-09-09).
 *
 * ⛔ NEVISÍ NA PUSH. Ohlášení sedí VEDLE push bloku, ne uvnitř: ten začíná
 * `await messagingLoader()`, takže build nebo zařízení bez funkčního Firebase
 * by otisk tiše neohlásilo a v administraci by nebylo co schvalovat — porucha
 * k nerozeznání od „správce mě ještě neschválil". Most na push je VOLITELNÝ
 * (`p_push_device_id`), chybí-li, ohlásí se otisk bez něj.
 *
 * ⛔ NEÚSPĚCH NESHODÍ PŘIHLÁŠENÍ ani push. Neohlášený otisk je CHYBĚJÍCÍ
 * POZOROVÁNÍ, ne důvod nepustit řidiče k práci — ale ani se nespolkne: vrací se
 * jako stav a zaloguje se.
 */
async function ohlasitPrukazZarizeni(pushDeviceId: string | null): Promise<void> {
  await withAuthenticatedUser(async () => {
    const vysledek = await ohlasZarizeni(pushDeviceId, {
      nactiPovereni: () => nativeZarizeni().nacti(),
      ohlas: async (v) => {
        const { error } = await api.rpc("register_knock_device", {
          p_kid: v.kid,
          p_public_key_hex: v.publicKeyHex,
          p_scope: v.scope,
          // Most se NEPOSÍLÁ jako `null`: argument je volitelný a vynechání je
          // pravdivější než prázdná hodnota ukazující do prázdna.
          ...(v.pushDeviceId === null ? {} : { p_push_device_id: v.pushDeviceId }),
        });
        if (error) throw error;
      },
    });

    if (vysledek.stav === "ohlaseno") {
      safeInfo("useNotifications.zarizeni_ohlaseno", { kid: vysledek.kid });
    } else if (vysledek.stav === "selhalo") {
      safeError("useNotifications.zarizeni_neohlaseno", vysledek.duvod);
    }
  });
}

/**
 * Ensure a mobile session row exists and optionally stores current FCM token.
 */
async function registerPushSession(context: PushSessionContext): Promise<void> {
  const { appVersion, deviceModel, platformLabel, systemVersion } = getDeviceMetadata();

  await withAuthenticatedUser(async () => {
    const { error } = await api.rpc("register_mobile_session", {
      p_app_version: appVersion,
      p_device_id: context.deviceId,
      p_device_name: deviceModel,
      p_fcm_token: context.fcmToken ?? undefined,
      p_os_version: systemVersion,
      p_platform: platformLabel,
    });

    if (error) throw error;
    safeInfo("useNotifications.session_registered");
  });
}

/**
 * Update push token on an existing mobile session row.
 */
async function updatePushSessionToken(context: PushSessionContext): Promise<void> {
  if (!context.fcmToken) return;

  await withAuthenticatedUser(async () => {
    const { error } = await api.rpc("update_push_token", {
      p_apns_token: undefined,
      p_device_id: context.deviceId,
      p_fcm_token: context.fcmToken,
    });

    if (error) throw error;
    safeInfo("useNotifications.token_synced");
  });
}

/**
 * Remove current device from mobile sessions, typically before sign-out.
 */
export async function unregisterPushSessionForCurrentDevice(): Promise<void> {
  try {
    await withAuthenticatedUser(async () => {
      const deviceId = await getOrCreatePushDeviceId();
      const { error } = await api.rpc("remove_mobile_session", {
        p_device_id: deviceId,
      });

      if (error) throw error;
      safeInfo("useNotifications.session_removed");
    });
  } catch (error) {
    safeError("useNotifications.unregisterPushSessionForCurrentDevice", error);
  }
}

interface UseNotificationsOptions {
  initialize?: boolean;
  messagingLoader?: () => Promise<MessagingClient>;
}

export function useNotifications(options?: UseNotificationsOptions) {
  const initialize = options?.initialize ?? true;
  const messagingLoader = options?.messagingLoader ?? getMessaging;
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);

  const requestPermission = useCallback(async () => {
    try {
      const messaging = await messagingLoader();
      const deviceId = await getOrCreatePushDeviceId();
      const authStatus = await messaging.requestPermission();
      const enabled =
        authStatus === 1 || // AUTHORIZED
        authStatus === 2;   // PROVISIONAL

      setPermissionGranted(enabled);

      await registerPushSession({ deviceId });

      if (enabled) {
        const token = await messaging.getToken();
        setFcmToken(token);
        await updatePushSessionToken({ deviceId, fcmToken: token });
        safeInfo("useNotifications.token_obtained");
        return token;
      }
    } catch (error) {
      safeError("useNotifications.requestPermission", error);
    }
    return null;
  }, [messagingLoader]);

  useEffect(() => {
    if (!initialize) {
      return;
    }

    let unsubscribeOnMessage: (() => void) | undefined;
    let unsubscribeOnTokenRefresh: (() => void) | undefined;

    // Vlastní blok: průkaz se ohlásí i tehdy, když push vůbec nenaběhne.
    void (async () => {
      try {
        const deviceId = await getOrCreatePushDeviceId().catch(() => null);
        await ohlasitPrukazZarizeni(deviceId);
      } catch (error) {
        safeError("useNotifications.ohlaseni_zarizeni", error);
      }
    })();

    (async () => {
      try {
        const messaging = await messagingLoader();
        const deviceId = await getOrCreatePushDeviceId();

        const authStatus = await messaging.hasPermission();
        const enabled = authStatus === 1 || authStatus === 2;
        setPermissionGranted(enabled);

        await registerPushSession({ deviceId });

        if (enabled) {
          const token = await messaging.getToken();
          setFcmToken(token);
          await updatePushSessionToken({ deviceId, fcmToken: token });
        }

        // Foreground message handler
        unsubscribeOnMessage = messaging.onMessage(async (remoteMessage) => {
          safeInfo("useNotifications.foreground_message", {
            title: remoteMessage.notification?.title,
          });
          // TODO: Show in-app notification toast
        });

        // Keep backend token in sync after Firebase rotation.
        unsubscribeOnTokenRefresh = messaging.onTokenRefresh(async (token) => {
          setFcmToken(token);
          try {
            await updatePushSessionToken({ deviceId, fcmToken: token });
          } catch (error) {
            safeError("useNotifications.onTokenRefresh", error);
          }
        });

        // Check if opened from notification
        const initialNotification = await messaging.getInitialNotification();
        if (initialNotification) {
          safeInfo("useNotifications.opened_from_notification", {
            data: initialNotification.data,
          });
        }
      } catch (error) {
        safeError("useNotifications.setup", error);
      }
    })();

    return () => {
      unsubscribeOnMessage?.();
      unsubscribeOnTokenRefresh?.();
    };
  }, [initialize, messagingLoader]);

  return {
    fcmToken,
    permissionGranted,
    requestPermission,
  };
}
