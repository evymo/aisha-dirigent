import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UnclaimedUsersPanel } from "@/components/partner/UnclaimedUsersPanel";
import { renderWithProviders } from "../utils/test-utils";
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

describe("UnclaimedUsersPanel", () => {
  const mockUnclaimedUsers = [
    {
      id: "550e8400-e29b-41d4-a716-446655440001",
      user_id: "550e8400-e29b-41d4-a716-446655440010",
      overall_feeling: 4,
      energy_perception: 5,
      primary_concern: "Chronic fatigue and low energy all day",
      main_goal: "Wake up with energy and be productive",
      age_range: "26-35",
      mentor_preference: "female",
      communication_style: "moderate",
      created_at: new Date().toISOString(),
      display_name: "Test User 1",
    },
    {
      id: "550e8400-e29b-41d4-a716-446655440002",
      user_id: "550e8400-e29b-41d4-a716-446655440020",
      overall_feeling: 6,
      energy_perception: 7,
      primary_concern: "Sleep issues and stress",
      main_goal: "Sleep better and manage stress",
      age_range: "36-45",
      mentor_preference: "male",
      communication_style: "frequent",
      created_at: new Date(Date.now() - 86400000).toISOString(),
      display_name: "Test User 2",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state while fetching", () => {
    vi.mocked(aisha.rpc).mockImplementation((() => new Promise(() => {})) as never);
    renderWithProviders(<UnclaimedUsersPanel />);
    expect(screen.getByText("partnerDashboard.unclaimedUsers.loading")).toBeInTheDocument();
  });

  it("renders empty state when no users are returned", async () => {
    vi.mocked(aisha.rpc).mockResolvedValueOnce({ data: [], error: null } as never);
    renderWithProviders(<UnclaimedUsersPanel />);

    await waitFor(() => {
      expect(screen.getByText("partnerDashboard.unclaimedUsers.empty.description")).toBeInTheDocument();
    });
  });

  it("renders user list from RPC data", async () => {
    vi.mocked(aisha.rpc).mockResolvedValueOnce({ data: mockUnclaimedUsers, error: null } as never);
    renderWithProviders(<UnclaimedUsersPanel />);

    await waitFor(() => {
      expect(screen.getByText("Test User 1")).toBeInTheDocument();
      expect(screen.getByText("Test User 2")).toBeInTheDocument();
    });
  });

  it("claims a user and removes them from the list", async () => {
    const user = userEvent.setup();
    let fetchCount = 0;

    vi.mocked(aisha.rpc).mockImplementation((async (fn: string) => {
      if (fn === "get_unclaimed_users_for_partners") {
        fetchCount++;
        // First fetch returns both users, subsequent fetches return only the second user
        if (fetchCount === 1) {
          return { data: mockUnclaimedUsers, error: null } as never;
        }
        // After claim, return only the second user (first one was claimed)
        return { data: [mockUnclaimedUsers[1]], error: null } as never;
      }
      if (fn === "claim_user_as_partner") {
        return { data: { success: true }, error: null } as never;
      }
      return { data: null, error: null } as never;
    }) as never);

    renderWithProviders(<UnclaimedUsersPanel />);

    await waitFor(() => {
      expect(screen.getByText("Test User 1")).toBeInTheDocument();
    });

    const claimButtons = screen.getAllByRole("button", {
      name: "partnerDashboard.unclaimedUsers.buttons.claim",
    });
    await user.click(claimButtons[0]);

    await waitFor(() => {
      expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith("claim_user_as_partner", {
        p_onboarding_id: "550e8400-e29b-41d4-a716-446655440001",
      });
    });

    // After refetch triggered by invalidateQueries, user should be removed
    await waitFor(() => {
      expect(screen.queryByText("Test User 1")).not.toBeInTheDocument();
    });

    expect(toastMock.success).toHaveBeenCalled();
  });

  it("shows a generic error toast when fetch fails", async () => {
    vi.mocked(aisha.rpc).mockResolvedValueOnce({
      data: null,
      error: new Error("Network error"),
    } as never);

    renderWithProviders(<UnclaimedUsersPanel />);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
  });
});
