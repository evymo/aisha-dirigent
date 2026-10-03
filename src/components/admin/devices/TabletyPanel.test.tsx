/**
 * Panel tabletů: vyrobený QR nesmí zmizet s neúspěšným obnovením na pozadí,
 * a předloha předvyplní nastavení — nikdy tajemství.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/admin/devices/NavodTablety", () => ({ NavodTablety: () => null }));
vi.mock("@/components/admin/devices/PrehledZarizeni", () => ({ PrehledZarizeni: () => null }));

const DATA = {
  zapnuto: true as const,
  hlidac: { applicationId: "com.example.hlidac", kioskPackage: "com.example.kiosk", versionName: "1.2.0", versionCode: 3, checksum: "x", spravce: "s" },
  stazeni: "https://api.example.test/storage/v1/zarizeni/hlidac.apk",
  apk: null,
  appky: [],
};
const ZADOST = {
  id: "z1",
  vytvoreno: "2026-09-22T18:00:00.000Z",
  autor: "technik@example.test",
  poznamka: "tablet 3",
  sit: { ssid: "Dilna", zabezpeceni: "WPA" as const },
  okno: "01:00-03:00",
  hlidac: { versionCode: 3, checksum: "x" },
};

const s = vi.hoisted(() => ({ konfigurace: {} as Record<string, unknown> }));
vi.mock("@/hooks/useZarizeniHlidac", () => ({
  useZarizeniKonfigurace: () => s.konfigurace,
  useZadostiHlidace: () => ({ isLoading: false, data: [ZADOST] }),
  useUlozitZadost: () => ({ mutate: vi.fn(), isPending: false }),
  useNahratHlidace: () => ({ mutate: vi.fn(), isPending: false }),
  useNahratAppku: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { TabletyPanel } from "./TabletyPanel";

beforeEach(() => {
  s.konfigurace = { data: DATA, isLoading: false, isError: false };
});

describe("TabletyPanel", () => {
  it("⛔ neúspěšné obnovení NAD daty panel neschová — jen řekne, že data jsou poslední načtená", () => {
    // Přesně tvar TanStacku 5.100 po chybě refetche: status error, data zůstávají.
    s.konfigurace = { data: DATA, isLoading: false, isError: true };
    render(<TabletyPanel />);
    expect(screen.getByText("admin.devices.tablets.qr.title")).toBeTruthy();
    expect(screen.getByText("admin.devices.tablets.loadStale")).toBeTruthy();
    expect(screen.queryByText("admin.devices.tablets.loadError")).toBeNull();
  });

  it("bez dat je to chyba načtení", () => {
    s.konfigurace = { data: undefined, isLoading: false, isError: true };
    render(<TabletyPanel />);
    expect(screen.getByText("admin.devices.tablets.loadError")).toBeTruthy();
  });

  it("předloha předvyplní síť a okno; heslo, PIN ani poznámku NE", () => {
    render(<TabletyPanel />);
    expect(screen.getByText("tablet 3")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("admin.devices.tablets.qr.note"), { target: { value: "jiný tablet" } });
    fireEvent.click(screen.getByText("admin.devices.tablets.requests.useAsTemplate"));
    expect((screen.getByLabelText("admin.devices.tablets.qr.ssid") as HTMLInputElement).value).toBe("Dilna");
    expect((screen.getByLabelText("admin.devices.tablets.qr.window") as HTMLInputElement).value).toBe("01:00-03:00");
    expect((screen.getByLabelText("admin.devices.tablets.qr.wifiPassword") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("admin.devices.tablets.qr.pin") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("admin.devices.tablets.qr.note") as HTMLInputElement).value).toBe("");
  });
});
