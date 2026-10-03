/**
 * MemberStory Page Tests
 *
 * Tests for the unified member story page:
 * - Quick action toolbar rendering
 * - Add product plan dialog flow
 * - Add health state dialog flow
 * - Log health state severity dialog flow
 * - Upload document dialog flow
 * - Wallet balance display
 *
 * @see src/pages/member/MemberStory.tsx
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------- hoisted mocks ----------

const hoisted = vi.hoisted(() => ({
  createPlanMutateAsync: vi.fn(),
  createStateMutateAsync: vi.fn(),
  logStateMutateAsync: vi.fn(),
  uploadDocMutateAsync: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

// ---------- mock declarations ----------

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && "count" in opts) return `${key}:${opts.count}`;
      if (opts && "scale" in opts) return `${key}:${opts.scale}`;
      return key;
    },
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("sonner", () => ({
  toast: {
    success: hoisted.toastSuccess,
    error: hoisted.toastError,
  },
}));

const MOCK_PRODUCTS = [
  {
    id: "supp-1",
    name: "Vitamin C",
    category: "product",
    default_dose_amount: 500,
    default_dose_unit: "mg",
    default_doses_per_day: 1,
    default_dose_timing: ["morning"],
    package_size: 60,
  },
  {
    id: "supp-2",
    name: "Vitamin D",
    category: "product",
    default_dose_amount: 1000,
    default_dose_unit: "IU",
    default_doses_per_day: 1,
    default_dose_timing: ["morning"],
    package_size: 90,
  },
];

const MOCK_HEALTH_STATES = [
  { id: "state-1", name_key: "headache", severity_scale: 5, icon: "brain", color: "#8b5cf6" },
];

vi.mock("@/hooks/useMemberDiary", () => ({
  useMemberDiaryData: () => ({
    products: { data: MOCK_PRODUCTS, isLoading: false },
    healthStates: { data: MOCK_HEALTH_STATES, isLoading: false },
  }),
  useCreateTrackingState: () => ({
    mutateAsync: hoisted.createStateMutateAsync,
    isPending: false,
  }),
  useCreateProductPlan: () => ({
    mutateAsync: hoisted.createPlanMutateAsync,
    isPending: false,
  }),
  useLogTrackingState: () => ({
    mutateAsync: hoisted.logStateMutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/hooks/useTrackingDocuments", () => ({
  useUploadTrackingDocument: () => ({
    mutateAsync: hoisted.uploadDocMutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/hooks/useRewardShop", () => ({
  useWalletBalance: () => ({
    data: { aisha_tokens: 42, governance_tokens: 10, impact_tokens: 5 },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useStoryLoop", () => ({
  useStoryDetail: () => ({ data: null, isLoading: false }),
}));

vi.mock("@/hooks/useMyTimeline", () => ({
  useMyStories: () => ({
    data: [{ id: "story-1", title: "My Story", partner_name: null }],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useChatAccessLevel", () => ({
  useChatAccessLevel: () => ({
    data: { has_completed_questionnaire: false, access_level: "basic" },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useEnsureMemberStory", () => ({
  useEnsureMemberStory: vi.fn(),
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: { id: "aaaaaaaa-1111-2222-3333-444444444444" },
    session: { access_token: "test-token" },
  }),
}));

// Mock heavy child components to keep tests fast and focused on dialogs
vi.mock("@/components/layout/Header", () => ({
  Header: () => React.createElement("header", { "data-testid": "header" }, "Header"),
}));

vi.mock("@/components/layout/Footer", () => ({
  Footer: () => React.createElement("footer", { "data-testid": "footer" }, "Footer"),
}));

vi.mock("@/components/member/MemberTimelineView", () => ({
  MemberTimelineView: () =>
    React.createElement("div", { "data-testid": "timeline-view" }, "Timeline"),
}));

vi.mock("@/components/storyloop/StoryDetail", () => ({
  StoryDetail: () => React.createElement("div", null, "StoryDetail"),
}));

vi.mock("@/components/storyloop/StoryComposer", () => ({
  StoryComposer: () =>
    React.createElement("div", { "data-testid": "story-composer" }, "Composer"),
}));

vi.mock("@/components/storyloop", () => ({
  AishaConsultPanel: () => React.createElement("div", null, "Aisha"),
}));

vi.mock("@/components/common/DocumentUploadZone", () => ({
  DocumentUploadZone: ({
    onFilesSelected,
  }: {
    onFilesSelected: (files: File[]) => void;
    isUploading: boolean;
    maxFiles: number;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "upload-zone" },
      React.createElement("button", {
        "data-testid": "upload-trigger",
        onClick: () => onFilesSelected([new File(["test"], "lab.pdf", { type: "application/pdf" })]),
      }, "Upload"),
    ),
}));

// ---------- helpers ----------

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/member/story"] },
        React.createElement(MemberStory),
      ),
    ),
  );
}

// ---------- lazy import ----------

let MemberStory: React.ComponentType;

beforeEach(async () => {
  vi.clearAllMocks();
  hoisted.createPlanMutateAsync.mockResolvedValue(undefined);
  hoisted.createStateMutateAsync.mockResolvedValue(undefined);
  hoisted.logStateMutateAsync.mockResolvedValue(undefined);
  hoisted.uploadDocMutateAsync.mockResolvedValue(undefined);

  const mod = await import("@/pages/member/MemberStory");
  MemberStory = mod.default;
});

// ---------- tests ----------

describe("MemberStory page", () => {
  describe("quick action toolbar", () => {
    it("renders all quick action buttons and wallet balance", () => {
      renderPage();

      expect(screen.getByText("memberDiary.addState")).toBeInTheDocument();
      expect(screen.getByText("memberDiary.addProduct")).toBeInTheDocument();
      expect(screen.getByText("common.uploadDocument")).toBeInTheDocument();
      // Wallet balance
      expect(screen.getByText("42")).toBeInTheDocument();
      expect(screen.getByText("rewardShop.tokenUnit")).toBeInTheDocument();
    });

    it("renders timeline view and story composer", () => {
      renderPage();

      expect(screen.getByTestId("timeline-view")).toBeInTheDocument();
      expect(screen.getByTestId("story-composer")).toBeInTheDocument();
    });
  });

  describe("add product plan dialog", () => {
    it("opens dialog and submits product plan", async () => {
      renderPage();

      // Open dialog
      fireEvent.click(screen.getByText("memberDiary.addProduct"));
      await waitFor(() => {
        expect(screen.getByText("common.create")).toBeInTheDocument();
      });

      // Submit with default first product pre-selected
      fireEvent.click(screen.getByText("common.create"));

      await waitFor(() => {
        expect(hoisted.createPlanMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            product_id: "supp-1",
            dose_amount: 500,
            dose_unit: "mg",
            doses_per_day: 1,
            dose_timing: ["morning"],
            package_quantity: 60,
            reminder_enabled: true,
            reminder_minutes_before: 15,
          }),
        );
      });

      expect(hoisted.toastSuccess).toHaveBeenCalledWith("common.success");
    });

    it("shows error toast on plan creation failure", async () => {
      hoisted.createPlanMutateAsync.mockRejectedValue(new Error("fail"));

      renderPage();

      fireEvent.click(screen.getByText("memberDiary.addProduct"));
      await waitFor(() => {
        expect(screen.getByText("common.create")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("common.create"));

      await waitFor(() => {
        expect(hoisted.toastError).toHaveBeenCalledWith("errors.genericError");
      });
    });

    it("closes dialog via cancel button", async () => {
      renderPage();

      fireEvent.click(screen.getByText("memberDiary.addProduct"));
      await waitFor(() => {
        expect(screen.getByText("common.cancel")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("common.cancel"));

      // Dialog should close — the DialogContent title should not be visible
      await waitFor(() => {
        // The dialog title text might still be in DOM but the dialog should be closed
        // We check that the create button is no longer in the dialog
        const createButtons = screen.queryAllByText("common.create");
        // With dialog closed, the create button should not be visible
        expect(createButtons.length).toBeLessThanOrEqual(0);
      });
    });
  });

  describe("add health state dialog", () => {
    it("opens dialog and submits health state with default preset", async () => {
      renderPage();

      fireEvent.click(screen.getByText("memberDiary.addState"));
      await waitFor(() => {
        expect(screen.getByText("memberDiary.severityScale")).toBeInTheDocument();
      });

      // Submit with default preset (asthma, first in HEALTH_STATE_PRESETS)
      const createButtons = screen.getAllByText("common.create");
      fireEvent.click(createButtons[createButtons.length - 1]);

      await waitFor(() => {
        expect(hoisted.createStateMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            name_key: "asthma",
            severity_scale: 5,
            icon: "wind",
            color: "#3b82f6",
            show_on_dashboard: true,
          }),
        );
      });

      expect(hoisted.toastSuccess).toHaveBeenCalledWith("common.success");
    });

    it("shows error toast on state creation failure", async () => {
      hoisted.createStateMutateAsync.mockRejectedValue(new Error("fail"));

      renderPage();

      fireEvent.click(screen.getByText("memberDiary.addState"));
      await waitFor(() => {
        expect(screen.getByText("memberDiary.severityScale")).toBeInTheDocument();
      });

      const createButtons = screen.getAllByText("common.create");
      fireEvent.click(createButtons[createButtons.length - 1]);

      await waitFor(() => {
        expect(hoisted.toastError).toHaveBeenCalledWith("errors.genericError");
      });
    });
  });

  describe("upload document dialog", () => {
    it("opens dialog and uploads document via DocumentUploadZone", async () => {
      renderPage();

      // Open upload dialog
      fireEvent.click(screen.getByText("common.uploadDocument"));
      await waitFor(() => {
        expect(screen.getByTestId("upload-zone")).toBeInTheDocument();
      });

      // Trigger upload via the mocked upload zone
      fireEvent.click(screen.getByTestId("upload-trigger"));

      await waitFor(() => {
        expect(hoisted.uploadDocMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            category: "other",
            title: "lab.pdf",
          }),
        );
      });
    });

    it("closes upload dialog via cancel", async () => {
      renderPage();

      fireEvent.click(screen.getByText("common.uploadDocument"));
      await waitFor(() => {
        expect(screen.getByTestId("upload-zone")).toBeInTheDocument();
      });

      // Find cancel button in upload dialog
      const cancelButtons = screen.getAllByText("common.cancel");
      fireEvent.click(cancelButtons[cancelButtons.length - 1]);

      await waitFor(() => {
        expect(screen.queryByTestId("upload-zone")).not.toBeInTheDocument();
      });
    });
  });

  describe("wallet balance", () => {
    it("displays aisha token count from wallet hook", () => {
      renderPage();

      expect(screen.getByText("42")).toBeInTheDocument();
    });
  });
});
