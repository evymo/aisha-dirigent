import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { Header } from "@/components/layout/Header";

// React Router v7+ has removed the future prop - v7 features are now default

// Mock PointerEvent for Radix UI
class MockPointerEvent extends Event {
  button: number;
  ctrlKey: boolean;
  pointerType: string;

  constructor(type: string, props: PointerEventInit) {
    super(type, props);
    this.button = props.button || 0;
    this.ctrlKey = props.ctrlKey || false;
    this.pointerType = props.pointerType || 'mouse';
  }
}

window.PointerEvent = MockPointerEvent as unknown as typeof PointerEvent;
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn();

const mockSignOut = vi.fn();
const mockUseAuth = vi.fn();
const mockUseCart = vi.fn();
const mockUseUserRole = vi.fn();
const mockUseMembership = vi.fn();
const mockUsePartnerProfile = vi.fn();
const mockUseWebPushSubscription = vi.fn();
const mockRuntimeFlags = vi.hoisted(() => ({
  isUsingAishaDevFallback: false,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => mockUseAuth(),
}));

vi.mock("@/components/layout/HeaderUserSection", async () => {
  const React = await import("react");
  const { useSession } = await import("@/hooks/useSession");

  function HeaderUserSectionMock() {
    const [isOpen, setIsOpen] = React.useState(false);
    const { signOut } = useSession();

    return (
      <div>
        <button
          aria-label="Open user menu"
          data-testid="user-menu"
          onClick={() => setIsOpen((value) => !value)}
          type="button"
        >
          user-menu
        </button>
        {isOpen ? (
          <button onClick={() => signOut()} type="button">
            header.signOut
          </button>
        ) : null}
      </div>
    );
  }

  function MobileUserSectionMock() {
    return null;
  }

  return {
    HeaderUserSection: HeaderUserSectionMock,
    MobileUserSection: MobileUserSectionMock,
  };
});

vi.mock("@/hooks/useCart", () => ({
  useCart: () => mockUseCart(),
}));

vi.mock("@/hooks/useDynamicTranslations", () => ({
  useDynamicTranslationsMap: () => ({}),
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
      { code: "EUR", rate: 1, symbol: "€" },
      { code: "CZK", rate: 25, symbol: "Kč" },
    ],
    isLoading: false,
  }),
}));

vi.mock("@/components/CurrencySwitcher", () => ({
  CurrencySwitcher: () => <div>currency</div>,
}));

vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => mockUseUserRole(),
}));

vi.mock("@/hooks/useMembership", () => ({
  useMembership: () => mockUseMembership(),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: vi.fn().mockReturnValue(false),
    hasAnyPermission: vi.fn().mockReturnValue(false),
    hasAllPermissions: vi.fn().mockReturnValue(false),
    permissions: [],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/usePartners", () => ({
  useMyPartnerProfile: () => mockUsePartnerProfile(),
}));

vi.mock("@/components/notifications/NotificationCenter", () => ({
  NotificationCenter: () => <div>notifications</div>,
}));

vi.mock("@/components/LanguageSwitcher", () => ({
  LanguageSwitcher: () => <div>lang</div>,
}));

vi.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => <div>theme</div>,
}));

vi.mock("@/hooks/useBrowserNotificationBridge", () => ({
  useBrowserNotificationBridge: vi.fn(),
}));

vi.mock("@/hooks/useWebPushSubscription", () => ({
  useWebPushSubscription: () => mockUseWebPushSubscription(),
}));

vi.mock("@/integrations/db/runtimeFlags", () => ({
  get isUsingAishaDevFallback() {
    return mockRuntimeFlags.isUsingAishaDevFallback;
  },
}));

const renderHeader = (options?: { isDevBackend?: boolean; initialEntries?: string[] }) => {
  mockRuntimeFlags.isUsingAishaDevFallback = options?.isDevBackend ?? false;
  render(
    <MemoryRouter initialEntries={options?.initialEntries}>
      <Header />
    </MemoryRouter>
  );
};

describe("Header", () => {
  beforeEach(() => {
    mockSignOut.mockReset();
    mockUseAuth.mockReset();
    mockUseCart.mockReset();
    mockUseUserRole.mockReset();
    mockUseMembership.mockReset();
    mockUsePartnerProfile.mockReset();
    mockUseWebPushSubscription.mockReset();

    mockUseAuth.mockReturnValue({
      
      user: null, session: null, isLoading: false, hasRole: vi.fn(), roles: [],
      signOut: mockSignOut,
    });
    mockUseCart.mockReturnValue({ itemCount: 0, items: [] });
    mockUseUserRole.mockReturnValue({
      isAdmin: false,
      isStaff: false,
      isPractitioner: false,
      roles: [],
    });
    mockUseMembership.mockReturnValue({ membership: null, isUpgraded: false });
    mockUsePartnerProfile.mockReturnValue({ data: null });
    mockUseWebPushSubscription.mockReturnValue({
      browserPushSupported: false,
      vapidConfigured: false,
      permission: "default",
      subscriptions: [],
      activeSubscriptionCount: 0,
      currentEndpoint: null,
      isCurrentBrowserSubscribed: false,
      isLoading: false,
      isError: false,
      error: null,
      isSyncing: false,
      isEnabling: false,
      isDisabling: false,
      syncSubscription: vi.fn(),
      enableWebPush: vi.fn(),
      disableWebPush: vi.fn(),
      refresh: vi.fn(),
    });
  });

  it("renders navigation and cart badge", async () => {
    mockUseCart.mockReturnValue({ itemCount: 3, items: [] });
    renderHeader({ initialEntries: ["/shop"] });

    expect(screen.getByText("web.nav.guild")).toBeInTheDocument();
    expect(screen.getByText("web.nav.references")).toBeInTheDocument();
    expect(screen.getByText("web.nav.about")).toBeInTheDocument();
    expect(screen.getAllByText("3")[0]).toBeInTheDocument();
  });

  it("shows dev backend badge when fallback is used", async () => {
    renderHeader({ isDevBackend: true });
    expect(screen.getByText("header.devBackend")).toBeInTheDocument();
  });

  it("opens user menu and signs out", async () => {
    const user = userEvent.setup();
    mockUseAuth.mockReturnValue({
      
      user: { id: '1' }, session: { user: { id: '1' } },
      isLoading: false, hasRole: vi.fn(), roles: [],
      signOut: mockSignOut,
    });
    mockUseMembership.mockReturnValue({
      membership: { tier: "gold" },
      isUpgraded: true,
    });

    renderHeader();
    const userMenuButton = await screen.findByRole(
      "button",
      { name: /open user menu/i },
      { timeout: 5000 },
    );
    await user.click(userMenuButton);

    const signOutItem = await screen.findByText(
      "header.signOut",
      undefined,
      { timeout: 5000 },
    );
    await user.click(signOutItem);

    expect(mockSignOut).toHaveBeenCalled();
  });
});
