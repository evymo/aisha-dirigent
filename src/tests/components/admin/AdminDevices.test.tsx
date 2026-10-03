import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "@/tests/utils/test-utils";
import AdminDevices from "@/pages/admin/AdminDevices";

const hoisted = vi.hoisted(() => ({
  mutateMock: vi.fn(),
  useKnockDevicesAdminMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.kid ? `${key}:${String(opts.kid)}` : opts?.ip ? `${key}:${String(opts.ip)}` : key,
  }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/hooks/useAdminData", () => ({
  useMembersSummary: () => ({
    loading: false,
    members: [{ user_id: "11111111-1111-4111-8111-111111111111", display_name: "Řidič Jedna", email: "r1@example.test" }],
  }),
}));

vi.mock("@/hooks/useAdminKnockDevices", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useAdminKnockDevices")>();
  return {
    ...actual,
    useKnockDevicesAdmin: () => hoisted.useKnockDevicesAdminMock(),
    useSetKnockDeviceApproval: () => ({ isPending: false, mutate: hoisted.mutateMock }),
  };
});

const OWNER = "11111111-1111-4111-8111-111111111111";
const base = {
  public_key_hex: `04${"ab".repeat(64)}`,
  scope: "ridic",
  owner_user_id: OWNER,
  push_device_id: null,
  first_seen_at: "2026-09-16T20:00:00+00:00",
  last_seen_at: "2026-09-16T21:00:00+00:00",
  revoked_at: null,
  uzivatele: [{ user_id: OWNER, last_active_at: null }],
};
const PENDING = { ...base, kid: "dev-aaaaaaaaaaaaaaaa", approved_at: null };
const APPROVED = { ...base, kid: "dev-bbbbbbbbbbbbbbbb", approved_at: "2026-09-16T21:30:00+00:00" };

describe("AdminDevices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.useKnockDevicesAdminMock.mockReturnValue({ data: [PENDING, APPROVED], isLoading: false, isError: false });
  });

  it("výchozí filtr ukazuje jen zařízení čekající na schválení", () => {
    render(<AdminDevices />);
    expect(screen.getByText(PENDING.kid)).toBeInTheDocument();
    expect(screen.queryByText(APPROVED.kid)).not.toBeInTheDocument();
  });

  it("⛔ upozornění, že schválení do dveří nedoteče samo, je vidět vždy", () => {
    render(<AdminDevices />);
    expect(screen.getByText("admin.devices.rosterNotice.title")).toBeInTheDocument();
  });

  it("uživatele ukazuje jménem, ne uuid", () => {
    render(<AdminDevices />);
    expect(screen.getAllByText("Řidič Jedna").length).toBeGreaterThan(0);
    expect(screen.queryByText(OWNER)).not.toBeInTheDocument();
  });

  it("schválení jde až přes potvrzení a pošle kid se schválením", async () => {
    render(<AdminDevices />);
    fireEvent.click(screen.getByRole("button", { name: /admin.devices.actions.approve/ }));
    expect(hoisted.mutateMock).not.toHaveBeenCalled();
    expect(await screen.findByText(`admin.devices.approveDialog.title:${PENDING.kid}`)).toBeInTheDocument();
    const potvrdit = screen.getAllByRole("button", { name: /admin.devices.actions.approve/ }).at(-1);
    fireEvent.click(potvrdit as HTMLElement);
    await waitFor(() =>
      expect(hoisted.mutateMock).toHaveBeenCalledWith({ approved: true, kid: PENDING.kid }, expect.anything()),
    );
  });

  it("tablet, který se ohlásil sám, čeká ke schválení s adresou a verzemi místo „zavedl“", () => {
    const TABLET = {
      ...base,
      kid: "dev-cccccccccccccccc",
      approved_at: null,
      owner_user_id: null,
      uzivatele: [],
      druh: "tablet",
      ohlaseno_z_ip: "198.51.100.83",
      verze: { ridic: "1.1.1 (15)" },
    };
    hoisted.useKnockDevicesAdminMock.mockReturnValue({ data: [TABLET], isLoading: false, isError: false });
    render(<AdminDevices />);
    expect(screen.getByText(TABLET.kid)).toBeInTheDocument();
    expect(screen.getByText("admin.devices.tabletAnnounced:198.51.100.83")).toBeInTheDocument();
    expect(screen.getByText("ridic 1.1.1 (15)")).toBeInTheDocument();
    expect(screen.queryByText("admin.devices.enrolledBy")).not.toBeInTheDocument();
  });

  it("chyba načtení se ukáže, ne prázdná tabulka", () => {
    hoisted.useKnockDevicesAdminMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<AdminDevices />);
    expect(screen.getByText("admin.devices.loadError")).toBeInTheDocument();
  });
});
