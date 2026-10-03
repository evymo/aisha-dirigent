import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PartnerBookingDialog } from "@/components/partners/PartnerBookingDialog";
import { renderWithProviders } from "../utils/test-utils";

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(),
    loading: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
  })
);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "cs", changeLanguage: vi.fn() },
  }),
}));

vi.mock("@/i18n", () => ({
  default: { language: "cs" },
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({ user: { id: "u1", email: "test@example.com" } }),
}));

vi.mock("@/hooks/useSecureMode", () => ({
  useSecureMode: () => ({
    isEnabled: false,
    isEnabling: false,
    enableWithPassword: vi.fn(async () => ({ ok: true })),
    secureClient: null,
  }),
}));

// Make calendar deterministic + easy to click in tests
vi.mock("@/components/ui/calendar", () => ({
  Calendar: ({ onSelect }: { onSelect: (d: Date) => void }) => (
    <button type="button" onClick={() => onSelect(new Date("2025-01-06T00:00:00Z"))}>
      calendar
    </button>
  ),
}));

const freeSlotsQueryOverrides = {
  data: undefined as { start_time: string; end_time: string; is_online: boolean }[] | undefined,
  isLoading: true,
};

vi.mock("@/hooks/usePartners", () => ({
  useCreateAppointment: () => ({ mutateAsync: vi.fn(async () => ({})) }),
  usePartnerFreeSlots: () => ({
    data: freeSlotsQueryOverrides.data,
    isLoading: freeSlotsQueryOverrides.isLoading,
  }),
}));

const defaultPartner = {
  id: "p1",
  user_id: "pu1",
  certification_level: "certified_partner" as const,
  is_production_provider: false,
  business_name: null,
  display_name: "Partner",
  description: null,
  notes_for_visitors: null,
  city: "Prague",
  country: "CZ",
  website: null,
  services: [] as string[],
  languages: null,
  is_visible: true,
  accepts_online_appointments: true,
  accepts_in_person_appointments: true,
  certification_passed_at: null,
  certification_score: null,
  avatar_url: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("PartnerBookingDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    freeSlotsQueryOverrides.data = undefined;
    freeSlotsQueryOverrides.isLoading = true;
  });

  it("should show loading instead of fallback time slots while free slots are loading", async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <PartnerBookingDialog
        partner={defaultPartner}
        open={true}
        onOpenChange={vi.fn()}
      />
    );

    // Select a date -> step becomes "time"
    await user.click(screen.getByRole("button", { name: "calendar" }));

    expect(screen.getByText("common.loading")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "09:00" })).not.toBeInTheDocument();
  }, 15_000);

  it("should show free time slots when data is available", async () => {
    freeSlotsQueryOverrides.data = [
      { start_time: "09:00", end_time: "09:30", is_online: true },
      { start_time: "10:00", end_time: "10:30", is_online: true },
      { start_time: "14:00", end_time: "14:30", is_online: false },
    ];
    freeSlotsQueryOverrides.isLoading = false;

    const user = userEvent.setup();

    renderWithProviders(
      <PartnerBookingDialog
        partner={defaultPartner}
        open={true}
        onOpenChange={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "calendar" }));

    expect(screen.getByRole("button", { name: "09:00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "10:00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "14:00" })).toBeInTheDocument();
    // 11:00 is NOT available — not returned by RPC
    expect(screen.queryByRole("button", { name: "11:00" })).not.toBeInTheDocument();
  });

  it("should show no-times message when free slots array is empty", async () => {
    freeSlotsQueryOverrides.data = [];
    freeSlotsQueryOverrides.isLoading = false;

    const user = userEvent.setup();

    renderWithProviders(
      <PartnerBookingDialog
        partner={defaultPartner}
        open={true}
        onOpenChange={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "calendar" }));

    expect(screen.getByText("partners.booking.noTimes")).toBeInTheDocument();
  });

  it("should advance to details step when a time slot is clicked", async () => {
    freeSlotsQueryOverrides.data = [
      { start_time: "09:00", end_time: "09:30", is_online: true },
    ];
    freeSlotsQueryOverrides.isLoading = false;

    const user = userEvent.setup();

    renderWithProviders(
      <PartnerBookingDialog
        partner={defaultPartner}
        open={true}
        onOpenChange={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "calendar" }));
    await user.click(screen.getByRole("button", { name: "09:00" }));

    // Should now show details step with appointment type options
    expect(screen.getByText("partners.booking.appointmentType")).toBeInTheDocument();
  });
});
