import { renderHook, waitFor } from "@testing-library/react-native";
import {
  useEnsureCosmosAddressRegistered,
  __resetCosmosRegistrationGuard,
} from "@/hooks/useEnsureCosmosAddressRegistered";
import { createQueryWrapper } from "@/__tests__/testUtils";

const mockRpc = jest.fn();

jest.mock("@/config/api", () => ({
  api: { rpc: (...args: unknown[]) => mockRpc(...args) },
  realtime: { channel: jest.fn(), removeChannel: jest.fn() },
}));

jest.mock("@/lib/security/safeLogger", () => ({ safeError: jest.fn() }));

// Valid cosmos bech32 (cosmos1 + lowercase alphanumeric, 39–59 chars).
const ADDR = "cosmos1qpzry9x8gf2tvdw0s3jn54khce6mua7lmnoprst";

describe("useEnsureCosmosAddressRegistered", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({ error: null });
    __resetCosmosRegistrationGuard();
  });

  it("registers the address via update_my_cosmos_address once initialized", async () => {
    renderHook(() => useEnsureCosmosAddressRegistered(ADDR, true), {
      wrapper: createQueryWrapper(),
    });
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith("update_my_cosmos_address", {
        p_cosmos_address: ADDR,
      }),
    );
  });

  it("does nothing without an address or before init", () => {
    renderHook(() => useEnsureCosmosAddressRegistered(null, true), {
      wrapper: createQueryWrapper(),
    });
    renderHook(() => useEnsureCosmosAddressRegistered(ADDR, false), {
      wrapper: createQueryWrapper(),
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("pushes a given address only once per session, even across re-mounts", async () => {
    const first = renderHook(() => useEnsureCosmosAddressRegistered(ADDR, true), {
      wrapper: createQueryWrapper(),
    });
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    first.unmount();

    // Re-mount with the same address → the module guard skips a second push.
    renderHook(() => useEnsureCosmosAddressRegistered(ADDR, true), {
      wrapper: createQueryWrapper(),
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});
