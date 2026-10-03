import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Checkout from "@/pages/Checkout";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// jsdom polyfills
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// React Router v7+ has removed the future prop - v7 features are now default

const mockNavigate = vi.fn();
const mockUseSession = vi.fn();
const mockUseCart = vi.fn();
const mockToast = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(),
    loading: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
  })
);
const mockRpc = vi.fn();

const mockSingle = vi.fn().mockResolvedValue({ data: null });
const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });

// Hoisted mocks for checkout hooks
const hoisted = vi.hoisted(() => ({
  useAvailableShippingMethods: vi.fn(),
  useCheckoutProfilePrefill: vi.fn(),
  useCheckoutVoucher: vi.fn(),
  useCompanyData: vi.fn(),
  useCreateCheckoutSession: vi.fn(),
  useCreateOrder: vi.fn(),
  usePacketaPickupPoints: vi.fn(),
  usePaymentMethodsConfig: vi.fn(),
  useSetupBankTransfer: vi.fn(),
  useShippingCosts: vi.fn(),
}));

vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: "en",
      changeLanguage: vi.fn(),
    },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => mockUseSession(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => mockUseCart(),
}));

vi.mock("@/hooks/useDynamicTranslations", () => ({
  useDynamicTranslationsMap: () => ({}),
  useDynamicTranslations: () => ({ data: [], isLoading: false }),
  useDynamicTranslationsWithStatus: () => ({ data: [], isLoading: false }),
  useDynamicTranslationsMultiLocale: () => ({ data: [], isLoading: false }),
  useDynamicT: () => ({ data: undefined, isLoading: false }),
  useTranslationsByKey: () => ({ data: [], isLoading: false }),
  useUpsertTranslation: () => ({ mutateAsync: vi.fn() }),
  useUpsertTranslations: () => ({ mutateAsync: vi.fn() }),
  useDeleteTranslation: () => ({ mutateAsync: vi.fn() }),
  useDeleteTranslationsByKey: () => ({ mutateAsync: vi.fn() }),
  useFetchTranslationsForKeys: () => ({ fetchTranslations: vi.fn() }),
  SUPPORTED_LOCALES: ["cs", "en", "de", "fr", "ru", "th"],
  LOCALE_LABELS: { cs: "Čeština", en: "English", de: "Deutsch", fr: "Français", ru: "Русский", th: "ไทย" },
}));

vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({
    formatPrice: (amount: number) => `€${amount.toFixed(2)}`,
    formatCurrency: (amount: number) => `€${amount.toFixed(2)}`,
    convertAmount: (amount: number) => amount,
    convertFromBase: (amount: number) => amount,
    preferredCurrency: "EUR",
    baseCurrency: "EUR",
    availableCurrencies: ["EUR", "CZK", "USD"],
    rates: {},
    isLoading: false,
    storedCurrency: null,
    getRateToCzk: () => 1,
    setPreferredCurrency: vi.fn(),
  }),
  useCurrencyRates: () => ({
    data: [
      { code: "EUR", rate: 1, symbol: "€", is_active: true },
      { code: "CZK", rate: 25, symbol: "Kč", is_active: true },
    ],
    isLoading: false,
  }),
}));

vi.mock("@/components/CurrencySwitcher", () => ({
  CurrencySwitcher: () => <div>currency</div>,
}));

// Header dependencies (not under test here)
vi.mock("@/hooks/usePartners", () => ({
  useMyPartnerProfile: () => ({
    data: null,
    isLoading: false,
  }),
  usePartners: () => ({
    data: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/useMembership", () => ({
  useMembership: () => ({
    membership: null,
    isUpgraded: false,
    loading: false,
  }),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock("@/hooks/useCheckoutVoucher", () => ({
  useCheckoutVoucher: (...args: unknown[]) => hoisted.useCheckoutVoucher(...args),
}));

vi.mock("@/hooks", () => {
  return {
    useAvailableShippingMethods: hoisted.useAvailableShippingMethods,
    useCheckoutProfilePrefill: hoisted.useCheckoutProfilePrefill,
    useCompanyData: hoisted.useCompanyData,
    useCreateCheckoutSession: hoisted.useCreateCheckoutSession,
    useCreateOrder: hoisted.useCreateOrder,
    usePacketaPickupPoints: hoisted.usePacketaPickupPoints,
    usePaymentMethodsConfig: hoisted.usePaymentMethodsConfig,
    useSetupBankTransfer: hoisted.useSetupBankTransfer,
    useShippingCosts: hoisted.useShippingCosts,
  };
});

// NOTE: Checkout sub-components (CheckoutShippingSection, CheckoutOrderSummary)
// are tested separately, so we don't mock @/pages/checkout here to keep
// integration-style tests realistic.

vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => ({
    notifications: [],
    unreadCount: 0,
    loading: false,
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    deleteNotification: vi.fn(),
  }),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (fn: string, params?: unknown) => mockRpc(fn, params),
    from: () => ({ select: () => ({ eq: () => ({ single: mockSingle }) }) }),
    channel: () => ({ on: () => ({ subscribe: () => {} }) }),
    removeChannel: vi.fn(),
  },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("Checkout page", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockToast.mockReset();
    mockRpc.mockResolvedValue({ data: null, error: null });

    // Default useCart returns empty cart
    mockUseCart.mockReturnValue({
      items: [],
      total: 0,
      loading: false,
      clearCart: vi.fn(),
    });

    // Default useSession returns unauthenticated
    mockUseSession.mockReturnValue({
      user: null,
      isLoading: false,
      hasRole: vi.fn(),
      roles: [],
      isAdmin: false,
      signOut: vi.fn(),
    });

    // Setup hoisted mocks with default values
    hoisted.useCheckoutProfilePrefill.mockReturnValue({
      data: null,
      isLoading: false,
    });
    hoisted.usePacketaPickupPoints.mockReturnValue({ data: [], isLoading: false });
    hoisted.useShippingCosts.mockReturnValue({ data: [], isLoading: false });
    hoisted.useAvailableShippingMethods.mockReturnValue({
      data: {
        carrierPickupPoints: [],
        carriers: [],
        costs: { packeta_pickup: 79, packeta_home: 99, personal_pickup: 0 },
        freeShippingThreshold: 1500,
        personalPickupAvailable: true,
        pickupPoints: [],
        totalBranchCount: 0,
        totalZboxCount: 0,
        zboxes: [],
      },
      isLoading: false,
    });
    hoisted.useCreateOrder.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ data: { id: "order-1" }, error: null }),
      isPending: false,
    });
    hoisted.useCreateCheckoutSession.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ data: { session_id: "sess-1" }, error: null }),
      isPending: false,
    });
    hoisted.useCheckoutVoucher.mockReturnValue({
      appliedVoucher: null,
      handleApplyVoucher: vi.fn(),
      handleRemoveVoucher: vi.fn(),
      isValidating: false,
      setVoucherCode: vi.fn(),
      voucherCode: "",
      voucherDiscount: 0,
    });
    hoisted.useCompanyData.mockReturnValue({
      consentInterpolation: { companyName: "Test Co" },
    });
    hoisted.usePaymentMethodsConfig.mockReturnValue({
      data: { card_enabled: true, bank_transfer_enabled: true, default_method: "card" },
      isLoading: false,
    });
    hoisted.useSetupBankTransfer.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ data: null, error: null }),
      isPending: false,
    });
  });

  it("redirects unauthenticated users", () => {
    mockUseSession.mockReturnValue({ 
      user: null, 
      isLoading: false,
      hasRole: vi.fn(),
      roles: [],
      isAdmin: false,
      signOut: vi.fn()
    });
    mockUseCart.mockReturnValue({ items: [{ id: "1" }], total: 10, loading: false, clearCart: vi.fn() });

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <MemoryRouter>
          <Checkout />
        </MemoryRouter>
      </Wrapper>
    );

    expect(mockNavigate).toHaveBeenCalledWith("/auth");
  });

  it("shows empty cart message when no items", () => {
    mockUseSession.mockReturnValue({ 
      user: { id: "u1" }, 
      isLoading: false,
      hasRole: vi.fn(),
      roles: [],
      isAdmin: false,
      signOut: vi.fn()
    });
    mockUseCart.mockReturnValue({ items: [], total: 0, loading: false, clearCart: vi.fn() });

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <MemoryRouter>
          <Checkout />
        </MemoryRouter>
      </Wrapper>
    );

    expect(screen.getByText("checkout.cartEmpty")).toBeInTheDocument();
  });

  it("renders checkout form when items exist", async () => {
    mockUseSession.mockReturnValue({ 
      user: { id: "u1", email: "a@b.com" }, 
      isLoading: false,
      hasRole: vi.fn(),
      roles: [],
      isAdmin: false,
      signOut: vi.fn()
    });
    mockUseCart.mockReturnValue({
      items: [
        { id: "1", quantity: 1, product_id: "p1", product: { name: "Item", price: 12 } },
      ],
      total: 12,
      loading: false,
      clearCart: vi.fn(),
    });

    // Setup profile prefill mock with email
    hoisted.useCheckoutProfilePrefill.mockReturnValue({
      data: { email: "a@b.com", phone: "", display_name: "Test User", address: null },
      isLoading: false,
    });

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <MemoryRouter>
          <Checkout />
        </MemoryRouter>
      </Wrapper>
    );

    expect(screen.getByText("checkout.title")).toBeInTheDocument();
    expect(screen.getAllByText("€12.00")[0]).toBeInTheDocument();

    // Let the profile prefill effect settle to avoid act warnings.
    const emailInput = screen.getByLabelText("checkout.email") as HTMLInputElement;
    await waitFor(() => {
      expect(emailInput.value).toBe("a@b.com");
    });
  });
});
