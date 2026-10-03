import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PrehledZarizeni } from "./PrehledZarizeni";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string, o?: { version?: string }) => (o?.version ? `${k}:${o.version}` : k) }) }));

const s = vi.hoisted(() => ({ q: null as unknown }));
vi.mock("@/hooks/useZarizeniHlidac", () => ({ useHlaseniZarizeni: () => s.q }));

const TED = new Date().toISOString();
const ZAKLAD = {
  zarizeni: "0f8fad5b-d9cb-469f-a165-70867728950e",
  model: "samsung SM-X110",
  android: "14 (34)",
  kioskAdmin: { versionName: "1.5.0", versionCode: 7 },
  appky: [{ balicek: "cz.example.ridic", versionCode: 15 }],
  webview: "com.google.android.webview 126.0.6478.110",
  rezim: "kiosk" as const,
  stav: "cz.example.ridic: nainstalováno.",
  prijato: TED,
  prvni: TED,
};
const CIL = {
  appky: [{ balicek: "cz.example.ridic", versionCode: 15, versionName: "1.1.1" }],
  kioskAdmin: { balicek: "cz.example.hlidac", versionCode: 7, versionName: "1.5.0" },
};

describe("přehled zařízení", () => {
  it("aktuální tablet: verze, prohlížeč, stav", () => {
    s.q = { isLoading: false, data: { zarizeni: [ZAKLAD], ...CIL } };
    const { container } = render(<PrehledZarizeni zapnuto />);
    expect(screen.getByText("samsung SM-X110")).toBeTruthy();
    expect(screen.getByText("com.google.android.webview 126.0.6478.110")).toBeTruthy();
    expect(screen.getByText("cz.example.ridic: nainstalováno.")).toBeTruthy();
    expect(container.querySelector("tr[data-stav]")?.getAttribute("data-stav")).toBe("aktualni");
  });

  it("⛔ tablet bez WebView a se starým Řidičem se nedá přehlédnout", () => {
    s.q = {
      isLoading: false,
      data: { zarizeni: [{ ...ZAKLAD, webview: null, appky: [{ balicek: "cz.example.ridic", versionCode: 14 }] }], ...CIL },
    };
    const { container } = render(<PrehledZarizeni zapnuto />);
    expect(screen.getByText("admin.devices.tablets.devices.noWebview")).toBeTruthy();
    expect(screen.getByText(/admin\.devices\.tablets\.devices\.outdated:1\.1\.1 \(15\)/)).toBeTruthy();
    expect(container.querySelector("tr[data-stav]")?.getAttribute("data-stav")).toBe("starsi");
  });

  it("⛔ Řidič na tabletu chybí → celý tablet „chybí“", () => {
    s.q = { isLoading: false, data: { zarizeni: [{ ...ZAKLAD, appky: [{ balicek: "cz.example.ridic", versionCode: -1 }] }], ...CIL } };
    const { container } = render(<PrehledZarizeni zapnuto />);
    expect(screen.getByText("admin.devices.tablets.devices.missing")).toBeTruthy();
    expect(container.querySelector("tr[data-stav]")?.getAttribute("data-stav")).toBe("chybi");
  });

  it("tablet, který mlčí přes 2 dny, je označený", () => {
    const stare = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    s.q = { isLoading: false, data: { zarizeni: [{ ...ZAKLAD, prijato: stare }], ...CIL } };
    render(<PrehledZarizeni zapnuto />);
    expect(screen.getByText("admin.devices.tablets.devices.silent")).toBeTruthy();
  });

  it("prázdno a chyba načtení se rozliší", () => {
    s.q = { isLoading: false, data: { zarizeni: [], ...CIL } };
    const { unmount } = render(<PrehledZarizeni zapnuto />);
    expect(screen.getByText("admin.devices.tablets.devices.empty")).toBeTruthy();
    unmount();
    s.q = { isLoading: false, data: undefined };
    render(<PrehledZarizeni zapnuto />);
    expect(screen.getByText("admin.devices.tablets.devices.loadError")).toBeTruthy();
  });
});
