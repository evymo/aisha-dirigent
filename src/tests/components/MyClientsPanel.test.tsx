import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../utils/test-utils";
import { MyClientsPanel } from "@/components/partner/MyClientsPanel";
import { aisha } from "@/integrations/db/client";

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(),
    loading: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
  })
);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options && typeof options.count === "number") return `${key}:${options.count}`;
      if (options && typeof options.name === "string") return `${key}:${options.name}`;
      if (options && typeof options.email === "string") return `${key}:${options.email}`;
      return key;
    },
    i18n: { language: "cs", changeLanguage: vi.fn() },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: vi.fn(),
  },
}));

describe("MyClientsPanel", () => {
  const mockClients = [
    {
      onboarding_id: "11111111-1111-1111-1111-111111111111",
      user_id: "22222222-2222-2222-2222-222222222222",
      display_name: "Test Client",
      overall_feeling: 5,
      energy_perception: 6,
      primary_concern: "Concern",
      main_goal: "Goal",
      phone_call_scheduled_at: null,
      phone_call_completed_at: null,
      onboarding_completed: false,
      has_data_sharing_consent: false,
      consent_status: "none",
      assigned_at: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state while fetching", () => {
    vi.mocked(aisha.rpc).mockImplementation((() => new Promise(() => {})) as never);
    renderWithProviders(<MyClientsPanel />);
    expect(screen.getByText("partnerDashboard.myClients.loading")).toBeInTheDocument();
  });

  it("renders empty state when no clients are returned", async () => {
    vi.mocked(aisha.rpc).mockResolvedValueOnce({ data: [], error: null } as never);
    renderWithProviders(<MyClientsPanel />);

    await waitFor(() => {
      expect(screen.getByText("partnerDashboard.myClients.noClients")).toBeInTheDocument();
    });
  });

  it("renders client list from RPC data", async () => {
    vi.mocked(aisha.rpc).mockResolvedValueOnce({ data: mockClients, error: null } as never);
    renderWithProviders(<MyClientsPanel />);

    await waitFor(() => {
      expect(screen.getByText("Test Client")).toBeInTheDocument();
    });
  });

  it("requests consent and refreshes the list", async () => {
    const user = userEvent.setup();

    vi.mocked(aisha.rpc).mockImplementation((async (fn: string, args?: unknown) => {
      if (fn === "get_my_assigned_clients") {
        return { data: mockClients, error: null } as never;
      }
      if (fn === "request_data_sharing_consent") {
        return { data: { success: true }, error: null } as never;
      }
      return { data: null, error: null } as never;
    }) as never);

    renderWithProviders(<MyClientsPanel />);

    await waitFor(() => {
      expect(screen.getByText("Test Client")).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: "partnerDashboard.myClients.buttons.requestConsent" })
    );

    await waitFor(() => {
      expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith("request_data_sharing_consent", {
        p_user_id: "22222222-2222-2222-2222-222222222222",
        p_message: "partnerDashboard.myClients.consent.requestMessage",
      });
    });

    expect(toastMock.success).toHaveBeenCalled();
  });
});

