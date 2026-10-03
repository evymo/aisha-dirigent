import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useStripeCheckout } from "@/hooks/useStripeCheckout";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  safeError: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  useSession: vi.fn(),
  useCurrency: vi.fn(),
  t: vi.fn((key: string) => key),
  parseRpcResponseSafe: vi.fn(),
  windowOpen: vi.fn(),
}));

vi.stubGlobal("open", mocks.windowOpen);

vi.mock("@/integrations/db/client", () => ({
  aisha: {
    functions: {
      invoke: (...args: unknown[]) => mocks.invoke(...args),
    },
  },
}));

vi.mock("@/lib/security/safeLogger", () => ({
  safeError: (...args: unknown[]) => mocks.safeError(...args),
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => mocks.useSession(),
}));

vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => mocks.useCurrency(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mocks.t }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mocks.toastSuccess(...args),
    error: (...args: unknown[]) => mocks.toastError(...args),
  },
}));

vi.mock("@/lib/schemas/hookSchemas", () => ({
  parseRpcResponseSafe: (...args: unknown[]) => mocks.parseRpcResponseSafe(...args),
}));

describe("useStripeCheckout", () => {
  const pkg = { id: "pro", price_monthly: 10, price_yearly: 100, name: "Pro" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mocks.useSession).mockReturnValue({ user: { id: "u1" } });
    vi.mocked(mocks.useCurrency).mockReturnValue({ preferredCurrency: "EUR" });
  });

  it("returns null for unauthenticated user", async () => {
    vi.mocked(mocks.useSession).mockReturnValue({ user: null });
    const { result } = renderHook(() => useStripeCheckout());

    const response = await result.current.createSubscriptionCheckout(pkg as never, "recurring");

    expect(response).toBeNull();
    expect(vi.mocked(mocks.invoke)).not.toHaveBeenCalled();
    expect(vi.mocked(mocks.toastError)).toHaveBeenCalled();
  });

  it("calls create-subscription-checkout and opens URL", async () => {
    vi.mocked(mocks.invoke).mockResolvedValue({ data: { raw: true }, error: null });
    vi.mocked(mocks.parseRpcResponseSafe).mockReturnValue({ url: "https://stripe.test/checkout" });

    const { result } = renderHook(() => useStripeCheckout());

    await act(async () => {
      await result.current.createSubscriptionCheckout(pkg as never, "recurring", "sub-1");
    });

    expect(vi.mocked(mocks.invoke)).toHaveBeenCalledWith("create-subscription-checkout", {
      body: {
        packageId: "pro",
        paymentType: "recurring",
        currency: "EUR",
        subscriptionId: "sub-1",
      },
    });
    expect(vi.mocked(mocks.windowOpen)).toHaveBeenCalledWith("https://stripe.test/checkout", "_blank");
  });

  it("logs safeError when checkout invocation fails", async () => {
    vi.mocked(mocks.invoke).mockResolvedValue({ data: null, error: { message: "boom" } });

    const { result } = renderHook(() => useStripeCheckout());
    await act(async () => {
      await result.current.createSubscriptionCheckout(pkg as never, "recurring");
    });

    expect(vi.mocked(mocks.safeError)).toHaveBeenCalledWith(
      "useStripeCheckout.createSubscriptionCheckout",
      expect.anything()
    );
    expect(vi.mocked(mocks.toastError)).toHaveBeenCalled();
  });
});
