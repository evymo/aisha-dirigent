import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import MemberProfile from "@/pages/member/MemberProfile";

// React Router v7+ has removed the future prop - v7 features are now default

const mockNavigate = vi.fn();
const mockUseSession = vi.fn();
const mockUseMembership = vi.fn();
const mockUseMemberProfile = vi.fn();
const mockSaveProfile = vi.fn();

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

vi.mock("@/components/layout/Header", () => ({
  Header: () => null,
}));

vi.mock("@/components/layout/Footer", () => ({
  Footer: () => null,
}));

vi.mock("@/components/security/RequireSecureMode", () => ({
  RequireSecureMode: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => mockUseSession(),
}));

vi.mock("@/hooks/useMembership", () => ({
  useMembership: () => mockUseMembership(),
}));

vi.mock("@/hooks/useMemberProfile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useMemberProfile")>();
  return {
    ...actual,
    useMemberProfile: () => mockUseMemberProfile(),
  };
});

vi.mock("@/hooks/useSecureMode", () => ({
  useSecureMode: () => ({
    isEnabled: true,
    isEnabling: false,
    enabledAt: Date.now(),
    secureClient: null,
    secureAccessToken: "test-token",
    enableWithPassword: vi.fn(),
    disable: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    promise: vi.fn(),
  }),
}));

vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => ({ isStaff: false, isAdmin: false, roles: [], loading: false }),
}));

vi.mock("@/components/member/StudyStatusCard", () => ({
  StudyStatusCard: () => null,
}));

vi.mock("@/components/member/DataSharingManager", () => ({
  DataSharingManager: () => null,
}));

vi.mock("@/hooks/useRequestPasswordChange", () => ({
  useRequestPasswordChange: () => ({
    requestPasswordChange: vi.fn(),
    isLoading: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
  }),
}));

vi.mock("@/hooks/useHasPassword", () => ({
  useHasPassword: () => ({
    hasPassword: true,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: () => false,
    permissions: [],
    isLoading: false,
  }),
}));

describe("MemberProfile", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockUseSession.mockReset();
    mockUseMembership.mockReset();
    mockUseMemberProfile.mockReset();
    mockSaveProfile.mockReset();

    mockUseSession.mockReturnValue({
      user: { id: "user-123", email: "user@example.com" },
      isLoading: false,
      hasRole: vi.fn().mockReturnValue(false),
      roles: ["member"],
      isAdmin: false,
      roleRecords: [],
      signOut: vi.fn(),
    });

    mockUseMembership.mockReturnValue({
      membership: { tier: "basic", status: "active" },
      isUpgraded: false,
    });
    mockUseMemberProfile.mockReturnValue({
      profile: {
        display_name: "Test User",
        phone: "",
        gender: "",
        date_of_birth: "",
        preferred_language: "cs",
        primary_diagnosis: "",
        current_medications: "",
        allergies: "",
        medical_history: "",
      },
      isLoading: false,
      isSaving: false,
      error: null,
      refreshProfile: vi.fn(),
      saveProfile: mockSaveProfile,
    });
  });

  it("loads profile through member profile hook", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MemberProfile />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(mockUseMemberProfile).toHaveBeenCalled();
    });
  });
});
