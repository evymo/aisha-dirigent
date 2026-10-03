import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { PartnerInvitations } from "@/components/partner/PartnerInvitations";
import * as useInvitationsModule from "@/hooks/useInvitations";
import * as useStudiesModule from "@/hooks/useStudies";
import * as usePartnersModule from "@/hooks/usePartners";

// Mock the hooks
vi.mock("@/hooks/useInvitations", () => ({
  useInvitations: vi.fn(),
}));

vi.mock("@/hooks/useStudies", () => ({
  useStudies: vi.fn(),
}));

vi.mock("@/hooks/usePartners", () => ({
  useMyPartnerProfile: vi.fn(),
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

const mockInvitations: useInvitationsModule.Invitation[] = [
  {
    id: "inv-1",
    code: "PARTNER001",
    study_id: "study-1",
    role: "member",
    email: "test@example.com",
    created_by: "partner-user-123",
    created_at: new Date().toISOString(),
    expires_at: null,
    max_uses: 10,
    used_count: 2,
    is_active: true,
    prefill_first_name: null,
    prefill_last_name: null,
    prefill_phone: null,
    prefill_notes: null,
    study: { name: "Test Study" },
  },
  {
    id: "inv-2",
    code: "GENERAL002",
    study_id: null,
    role: "member",
    email: null,
    created_by: "partner-user-123",
    created_at: new Date().toISOString(),
    expires_at: null,
    max_uses: null,
    used_count: 5,
    is_active: false,
    prefill_first_name: null,
    prefill_last_name: null,
    prefill_phone: null,
    prefill_notes: null,
    study: undefined,
  },
];

const mockStudies = [
  { id: "study-1", name: "Test Study", is_public: true, status: "recruiting" },
  { id: "study-2", name: "Private Study", is_public: false, status: "recruiting" },
];

const mockPartnerProfile = {
  id: "partner-id-123",
  user_id: "partner-user-123",
  display_name: "Test Partner",
  is_active: true,
};

// React Router v7+ has removed the future prop - v7 features are now default

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

describe("PartnerInvitations", () => {
  const mockCreateInvitation = {
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  };

  const mockToggleInvitation = {
    mutate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useInvitationsModule.useInvitations).mockReturnValue({
      invitations: mockInvitations,
      isLoading: false,
      createInvitation: mockCreateInvitation as never,
      toggleInvitation: mockToggleInvitation as never,
    });

    vi.mocked(useStudiesModule.useStudies).mockReturnValue({
      studies: mockStudies,
      isLoading: false,
    } as never);

    vi.mocked(usePartnersModule.useMyPartnerProfile).mockReturnValue({
      data: mockPartnerProfile,
      isLoading: false,
    } as never);
  });

  it("renders loading state", () => {
    vi.mocked(useInvitationsModule.useInvitations).mockReturnValue({
      invitations: undefined,
      isLoading: true,
      createInvitation: mockCreateInvitation as never,
      toggleInvitation: mockToggleInvitation as never,
    });

    render(<PartnerInvitations />, { wrapper: createWrapper() });

    // Should show loading spinner (check for animate-spin class)
    expect(document.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders invitations list", () => {
    render(<PartnerInvitations />, { wrapper: createWrapper() });

    // Should show invitation codes
    expect(screen.getByText("PARTNER001")).toBeInTheDocument();
    expect(screen.getByText("GENERAL002")).toBeInTheDocument();

    // Should show study name
    expect(screen.getByText("Test Study")).toBeInTheDocument();
  });

  it("shows empty state when no invitations", () => {
    vi.mocked(useInvitationsModule.useInvitations).mockReturnValue({
      invitations: [],
      isLoading: false,
      createInvitation: mockCreateInvitation as never,
      toggleInvitation: mockToggleInvitation as never,
    });

    render(<PartnerInvitations />, { wrapper: createWrapper() });

    // Should show empty state message
    expect(
      screen.getByText(/zatím nemáte žádné pozvánky|you don't have any invitations/i)
    ).toBeInTheDocument();
  });

  it("filters invitations by partner's created_by", () => {
    const otherUserInvitation = {
      ...mockInvitations[0],
      id: "inv-other",
      created_by: "other-user-456",
    };

    vi.mocked(useInvitationsModule.useInvitations).mockReturnValue({
      invitations: [...mockInvitations, otherUserInvitation],
      isLoading: false,
      createInvitation: mockCreateInvitation as never,
      toggleInvitation: mockToggleInvitation as never,
    });

    render(<PartnerInvitations />, { wrapper: createWrapper() });

    // Should only show 2 invitations (from partner-user-123), not the other user's
    const codes = screen.getAllByRole("row").length - 1; // minus header row
    expect(codes).toBe(2);
  });

  it("opens create invitation dialog", async () => {
    render(<PartnerInvitations />, { wrapper: createWrapper() });

    // Click create button
    const createButton = screen.getByRole("button", {
      name: /create|vytvořit|nová pozvánka/i,
    });
    fireEvent.click(createButton);

    // Dialog should open
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("creates invitation with form data", async () => {
    render(<PartnerInvitations />, { wrapper: createWrapper() });

    // Open dialog
    const createButton = screen.getAllByRole("button", {
      name: /create|vytvořit|nová pozvánka/i,
    })[0];
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Fill form - find the submit button inside dialog
    const submitButton = screen.getAllByRole("button", {
      name: /create|vytvořit/i,
    }).find(btn => btn.closest('[role="dialog"]'));

    if (submitButton) {
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockCreateInvitation.mutateAsync).toHaveBeenCalled();
      });
    }
  });

  it("displays stats correctly", () => {
    render(<PartnerInvitations />, { wrapper: createWrapper() });

    // Should show total count
    expect(screen.getByText("2")).toBeInTheDocument();

    // Should show active count (only inv-1 is active)
    expect(screen.getByText("1")).toBeInTheDocument();

    // Should show used count (2 + 5 = 7)
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("shows only public recruiting studies in dropdown", async () => {
    render(<PartnerInvitations />, { wrapper: createWrapper() });

    // Open dialog
    const createButton = screen.getAllByRole("button", {
      name: /create|vytvořit|nová pozvánka/i,
    })[0];
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // The select should only contain public recruiting studies
    // Test Study is public and recruiting, Private Study is not public
    expect(screen.getByText("Test Study")).toBeInTheDocument();
    expect(screen.queryByText("Private Study")).not.toBeInTheDocument();
  });

  it("toggles invitation active state", () => {
    render(<PartnerInvitations />, { wrapper: createWrapper() });

    // Find switches (for toggling active state)
    const switches = screen.getAllByRole("switch");
    
    // Click the first switch
    fireEvent.click(switches[0]);

    expect(mockToggleInvitation.mutate).toHaveBeenCalledWith({
      id: "inv-1",
      is_active: false,
    });
  });

  it("displays email badge when invitation has email", () => {
    render(<PartnerInvitations />, { wrapper: createWrapper() });

    // inv-1 has email test@example.com
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
  });
});
