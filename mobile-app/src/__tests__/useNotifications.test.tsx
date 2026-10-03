import { act, renderHook, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import {
  unregisterPushSessionForCurrentDevice,
  useNotifications,
} from "@/hooks/useNotifications";

const mockIsLoggedIn = jest.fn();
const mockRpc = jest.fn();
const mockGetItemAsync = jest.fn();
const mockSetItemAsync = jest.fn();
const mockHasPermission = jest.fn();
const mockRequestPermission = jest.fn();
const mockGetToken = jest.fn();
const mockOnMessage = jest.fn((_listener: unknown) => jest.fn());
const mockOnTokenRefresh = jest.fn((_listener: unknown) => jest.fn());
const mockGetInitialNotification = jest.fn();
const mockSafeError = jest.fn();
const mockSafeInfo = jest.fn();
const mockMessagingClient = {
  getInitialNotification: () => mockGetInitialNotification(),
  getToken: () => mockGetToken(),
  hasPermission: () => mockHasPermission(),
  onMessage: (listener: unknown) => mockOnMessage(listener),
  onTokenRefresh: (listener: unknown) => mockOnTokenRefresh(listener),
  requestPermission: () => mockRequestPermission(),
};

jest.mock("@/config/api", () => ({
  api: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
  realtime: {
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

// ⛔ VSTUP SE DEKLARUJE. `useNotifications` od 2026-09-11 ohlašuje průkaz
// zařízení, a `@/lib/knock-native` linkuje nativní krypto (react-native-udp,
// quick-crypto), které jest nepřeloží. Atrapa je tedy podmínka běhu, ne
// pohodlí — bez ní se celá suita ani nespustí.
const mockNactiPrukaz = jest.fn();
jest.mock("@/lib/knock-native", () => ({
  nativeZarizeni: () => ({ nacti: (...a: unknown[]) => mockNactiPrukaz(...a) }),
}));

jest.mock("@/config/oidc", () => ({
  isLoggedIn: (...args: unknown[]) => mockIsLoggedIn(...args),
}));

jest.mock("@/lib/security/safeLogger", () => ({
  safeError: (...args: unknown[]) => mockSafeError(...args),
  safeInfo: (...args: unknown[]) => mockSafeInfo(...args),
}));

jest.mock("expo-constants", () => ({
  expoConfig: {
    version: "1.0.0",
  },
}));

jest.mock("expo-device", () => ({
  modelId: "AishaDevice",
  modelName: "Aisha Phone",
  osVersion: "18.0",
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: (...args: unknown[]) => mockGetItemAsync(...args),
  setItemAsync: (...args: unknown[]) => mockSetItemAsync(...args),
}));

describe("useNotifications", () => {
  beforeEach(() => {
    mockIsLoggedIn.mockReset();
    mockRpc.mockReset();
    mockGetItemAsync.mockReset();
    mockSetItemAsync.mockReset();
    mockHasPermission.mockReset();
    mockRequestPermission.mockReset();
    mockGetToken.mockReset();
    mockOnMessage.mockReset();
    mockOnTokenRefresh.mockReset();
    mockGetInitialNotification.mockReset();
    mockSafeError.mockReset();
    mockSafeInfo.mockReset();

    mockIsLoggedIn.mockResolvedValue(true);
    mockGetItemAsync.mockResolvedValue(null);
    mockSetItemAsync.mockResolvedValue(undefined);
    mockRequestPermission.mockResolvedValue(1);
    mockGetToken.mockResolvedValue("fcm-token");
    mockRpc.mockResolvedValue({ error: null });
  });

  it("registers the session and syncs the push token on permission request", async () => {
    const { result } = renderHook(() =>
      useNotifications({
        initialize: false,
        messagingLoader: async () => mockMessagingClient,
      }),
    );

    await act(async () => {
      await result.current.requestPermission();
    });

    expect(mockSafeError).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.permissionGranted).toBe(true);
      expect(result.current.fcmToken).toBe("fcm-token");
    });
    expect(mockRpc).toHaveBeenNthCalledWith(
      1,
      "register_mobile_session",
      expect.objectContaining({
        p_app_version: "1.0.0",
        p_fcm_token: undefined,
        p_platform: Platform.OS,
      }),
    );
    expect(mockRpc).toHaveBeenNthCalledWith(
      2,
      "update_push_token",
      expect.objectContaining({
        p_apns_token: undefined,
        p_fcm_token: "fcm-token",
      }),
    );
  });

  it("⛔ ohlásí průkaz zařízení — a NEVISÍ to na push oprávnění", async () => {
    // Kdyby ohlášení sedělo uvnitř push bloku, zařízení bez funkčního Firebase
    // by se v administraci nikdy neobjevilo a vypadalo by to jako „správce mě
    // neschválil". Proto se měří, že otisk odejde i tak.
    mockNactiPrukaz.mockResolvedValue({
      kid: "dev-16b5e71e4f33917d",
      privateKeyPem: "SOUKROMY-KLIC-NESMI-VEN",
      publicKeyHex: `04${"ab".repeat(32)}`,
      scope: "ops",
    });

    renderHook(() => useNotifications({ initialize: true }));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith("register_knock_device", expect.objectContaining({
        p_kid: "dev-16b5e71e4f33917d",
        p_public_key_hex: `04${"ab".repeat(32)}`,
        p_scope: "ops",
      }));
    });
  });

  it("⭐ bez zavedeného průkazu se neohlašuje nic (není to chyba)", async () => {
    mockNactiPrukaz.mockResolvedValue(null);

    renderHook(() => useNotifications({ initialize: true }));

    // ⛔ ČEKÁ SE NA PRŮCHOD CESTY, NE NA VEDLEJŠÍ EFEKT. Čekat na „jakékoli RPC"
    // by tu nikdy nedoběhlo: bez průkazu se neohlašuje a push v tomhle běhu
    // nenaběhne — test by pak měřil timeout, ne rozhodnutí.
    await waitFor(() => expect(mockNactiPrukaz).toHaveBeenCalled());
    expect(mockRpc.mock.calls.map((c) => c[0])).not.toContain("register_knock_device");
  });

  it("removes the current device session during unregister", async () => {
    mockGetItemAsync.mockResolvedValue("device-123");

    await unregisterPushSessionForCurrentDevice();

    expect(mockRpc).toHaveBeenCalledWith("remove_mobile_session", {
      p_device_id: "device-123",
    });
  });
});
