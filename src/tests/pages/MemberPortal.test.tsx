import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MemberPortal from "@/pages/MemberPortal";

// React Router v7+ has removed the future prop - v7 features are now default

const mockNavigate = vi.fn();
const mockUseSession = vi.fn();
const mockUseMembership = vi.fn();
const mockUseSubscriptionPackages = vi.fn();
const mockUseStudies = vi.fn();
const mockUseMyRegistrations = vi.fn();
const mockUseTrackingCheckIns = vi.fn();
const mockUseLabResults = vi.fn();

const mockUseRIIMembership = vi.fn();
const mockUseHasInformedConsent = vi.fn();
const mockUseMyQualificationResults = vi.fn();
const mockUseMyPartnerCertification = vi.fn();
const mockUseSubscriptionPurchase = vi.fn();
const mockUseMySubscriptions = vi.fn();

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
    }
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => mockUseSession(),
}));

vi.mock("@/hooks/useSecureMode", () => ({
  useSecureMode: () => ({
    isEnabled: true,
    isEnabling: false,
    enabledAt: Date.now(),
    secureClient: {},
    secureAccessToken: "test-token",
    enableWithPassword: vi.fn(),
    disable: vi.fn(),
  }),
}));

vi.mock("@/hooks/useMembership", () => ({
  useMembership: () => mockUseMembership(),
  useSubscriptionPackages: () => mockUseSubscriptionPackages(),
}));

vi.mock("@/hooks/useStudies", () => ({
  useStudies: () => mockUseStudies(),
  useMyRegistrations: () => mockUseMyRegistrations(),
}));

vi.mock("@/hooks/useTracking", () => ({
  useTrackingCheckIns: () => mockUseTrackingCheckIns(),
  useLabResults: () => mockUseLabResults(),
}));



vi.mock("@/hooks/useRIIMembership", () => ({
  useRIIMembership: () => mockUseRIIMembership(),
}));

vi.mock("@/hooks/useInformedConsent", () => ({
  useHasInformedConsent: () => mockUseHasInformedConsent(),
}));

vi.mock("@/hooks/useTestResults", () => ({
  useMyQualificationResults: () => mockUseMyQualificationResults(),
  useMyPartnerCertification: () => mockUseMyPartnerCertification(),
}));

vi.mock("@/hooks/useSubscriptionPurchase", () => ({
  useSubscriptionPurchase: () => mockUseSubscriptionPurchase(),
  useMySubscriptions: () => mockUseMySubscriptions(),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: () => false,
    permissions: [],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useStripeCheckout", () => ({
  useStripeCheckout: () => ({
    createSubscriptionCheckout: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/components/layout/Header", () => ({
  Header: () => null,
}));

vi.mock("@/components/layout/Footer", () => ({
  Footer: () => null,
}));

vi.mock("@/components/security/RequireSecureMode", () => ({
  RequireSecureMode: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("MemberPortal", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockUseSession.mockReset();
    mockUseMembership.mockReset();
    mockUseSubscriptionPackages.mockReset();
    mockUseStudies.mockReset();
    mockUseMyRegistrations.mockReset();
    mockUseTrackingCheckIns.mockReset();
    mockUseLabResults.mockReset();
    mockUseRIIMembership.mockReset();
    mockUseHasInformedConsent.mockReset();
    mockUseMyQualificationResults.mockReset();
    mockUseMyPartnerCertification.mockReset();
    mockUseSubscriptionPurchase.mockReset();
    mockUseMySubscriptions.mockReset();

    // Default mock returns
    mockUseSession.mockReturnValue({
      user: { id: "123" },
      isLoading: false,
      hasRole: vi.fn().mockReturnValue(true),
      roles: ["member"],
      isAdmin: false,
      signOut: vi.fn(),
    });
    mockUseMembership.mockReturnValue({ membership: null, loading: false });
    mockUseSubscriptionPackages.mockReturnValue({ packages: [], loading: false });
    mockUseStudies.mockReturnValue({ studies: [], loading: false });
    mockUseMyRegistrations.mockReturnValue({ registrations: [], loading: false });
    mockUseTrackingCheckIns.mockReturnValue({ checkIns: [], todayCheckIn: null, loading: false });
    mockUseLabResults.mockReturnValue({ labResults: [], loading: false });
    mockUseRIIMembership.mockReturnValue({ isMember: false, loading: false });
    mockUseHasInformedConsent.mockReturnValue({ hasConsent: true, loading: false });
    mockUseMyQualificationResults.mockReturnValue({ results: [], loading: false });
    mockUseMyPartnerCertification.mockReturnValue({ certification: null, loading: false });
    mockUseSubscriptionPurchase.mockReturnValue({ purchaseSubscription: vi.fn(), isLoading: false });
    mockUseMySubscriptions.mockReturnValue({ subscriptions: [], loading: false });
  });

  it("renders the portal dashboard", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MemberPortal />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(screen.getByText("memberPortal.title")).toBeInTheDocument();
  });

  // Note: Auth redirect test removed because authentication is now handled by 
  // RequireAuth wrapper in App.tsx, not by MemberPortal component itself.
  // This is the correct separation of concerns - auth guard at router level.
  // See src/tests/components/RequireAuth.test.tsx for auth redirect tests.
});
