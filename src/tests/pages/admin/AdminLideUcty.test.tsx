/**
 * Lidé a účty: HR vidí účty i osoby bez účtu, přiřadí je z obou stran
 * a chybu „osoba má jiný účet" dostane vysvětlenou, ne obecnou.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/hooks/useDebounce", () => ({ useDebounce: <T,>(v: T) => v }));

const UCET = { user_id: "u-1", email: "jan@firma.test", jmeno: "Jan Novák", vytvoreno: null, osoba: null };
const UCET_S_OSOBOU = {
  user_id: "u-2", email: "eva@firma.test", jmeno: "Eva", vytvoreno: null,
  osoba: { ref_id: "r-2", twin_id: "t-9", label: "Eva Stará", entity_type: "person", od: null },
};
const OSOBA = {
  twin_id: "t-1", twin_label: "KOŽUŠNÍK Petr", entity_type: "driver",
  refs: [{ source: "webdispecink", source_key: "WD-4711", ref_kind: "primary_id" }],
  pozvanky: [], navrhy_uctu: [], kroky: { celkem: 2709, ceka: 12 },
};

const s = vi.hoisted(() => ({
  mutate: vi.fn(),
  odvaz: vi.fn(),
  vratit: vi.fn(),
  udelit: vi.fn(),
  priraditIdentitu: vi.fn(),
  odebratIdentitu: vi.fn(),
  udelitZdroj: vi.fn(),
  zdroje: null as unknown,
  vazby: null as unknown,
  identity: [] as unknown[],
  sekce: [] as unknown[],
  rozhodnuti: [] as unknown[],
  druhy: [] as unknown[],
  ucty: { items: [] as unknown[], count: 0, limitovano: false },
  osoby: { items: [] as unknown[], count: 0, limitovano: false },
}));
vi.mock("@/hooks/useHrLideUcty", () => {
  // Jiné jméno než import nahoře: vitest by jinak odkaz přepsal na hoistovaný import.
  class JinyUcetMock extends Error {}
  return {
    OsobaMaJinyUcet: JinyUcetMock,
    useHrUcty: () => ({ isLoading: false, isError: false, data: s.ucty }),
    useOsobyBezUctu: () => ({ isLoading: false, isError: false, data: s.osoby }),
    usePriraditUcet: () => ({ mutate: s.mutate, isPending: false }),
    useOdvazatUcet: () => ({ mutate: s.odvaz, isPending: false }),
    useRozhodnutiSjednoceni: () => ({ isLoading: false, isError: false, data: s.rozhodnuti }),
    useVratitRozhodnuti: () => ({ mutate: s.vratit, isPending: false }),
    useSjednotitOsobu: () => ({ mutate: vi.fn(), isPending: false }),
    useDruhyOsob: () => ({ data: s.druhy }),
    useSekceUctu: (id: string | null) => ({ isLoading: false, isError: false, data: id ? s.sekce : undefined }),
    useUdelitSekci: () => ({ mutate: s.udelit, isPending: false }),
    useVazbyUctu: (id: string | null) => ({ isLoading: false, isError: false, data: id ? s.vazby : undefined }),
    useHledatIdentity: () => ({ data: s.identity }),
    usePriraditIdentitu: () => ({ mutate: s.priraditIdentitu, isPending: false }),
    useOdebratIdentitu: () => ({ mutate: s.odebratIdentitu, isPending: false }),
    useZdrojeUctu: (id: string | null) => ({ isLoading: false, isError: false, data: id ? s.zdroje : undefined }),
    useUdelitZdroj: () => ({ mutate: s.udelitZdroj, isPending: false }),
    OdmitnutiSjednoceni: class OdmitnutiMock extends Error {},
  };
});

import AdminLideUcty from "@/pages/admin/AdminLideUcty";
import { OsobaMaJinyUcet } from "@/hooks/useHrLideUcty";

beforeEach(() => {
  vi.clearAllMocks();
  s.ucty = { items: [UCET, UCET_S_OSOBOU], count: 2, limitovano: false };
  s.osoby = { items: [OSOBA], count: 1, limitovano: false };
  s.rozhodnuti = [];
  s.sekce = [{ surface: "smlouvy", title_key: "app.nav.smlouvy", udeleno: false, granted_at: null }];
  s.vazby = { osoba: null, druhy: ["spravuje"], vazby: [
    { relation_id: "rel-1", twin_id: "t-mn", label: "Moravská nemovitostní", entity_type: "company", relation_kind: "spravuje", od: null, identifikatoru: 2 },
  ] };
  s.identity = [{ twin_id: "t-av", label: "Autoavant", entity_type: "object", identifikatoru: 0 }];
  s.zdroje = {
    vse: { zdroj: "vse:*", dokladu: 70219, udeleno: false },
    vstupy: [{ zdroj: "vstup:dokumenty", label: "dokumenty", dokladu: 1023, udeleno: false }],
    dvojcata: [{ zdroj: "udalosti:sez-vyuctovani", label: "sez-vyuctovani", dokladu: 121, druhy: "unit", udeleno: false }],
    instance: [
      { zdroj: "instance:money/Areál Avant Ďáblická", label: "money/Areál Avant Ďáblická", dokladu: 740, udeleno: false },
      { zdroj: "instance:money/MODĚVA nemovitostní, družstvo", label: "money/MODĚVA nemovitostní, družstvo", dokladu: 186, udeleno: true },
    ],
    slozky: [],
    firmy: [{ zdroj: "firma:28282264", label: "Moravská nemovitostní a.s.", ico: "28282264", dokladu: 136, udeleno: false }],
  };
  s.druhy = [
    { entity_type: "company", celkem: 2286, bez_uctu: 2286 },
    { entity_type: "driver", celkem: 1487, bez_uctu: 1487 },
  ];
});

describe("AdminLideUcty", () => {
  it("ukáže účty (s osobou i bez) a osoby bez účtu i s počtem úkolů", () => {
    render(<AdminLideUcty />);
    expect(screen.getByText("Jan Novák")).toBeTruthy();
    expect(screen.getByText("admin.people.accounts.none")).toBeTruthy();
    expect(screen.getByText("Eva Stará")).toBeTruthy();
    expect(screen.getByText("KOŽUŠNÍK Petr")).toBeTruthy();
    expect(screen.getByText("WD-4711")).toBeTruthy();
    expect(screen.getByText("admin.people.persons.tasks")).toBeTruthy();
  });

  it("přiřazení od osoby: vybraný účet + tahle osoba jdou do mutace", async () => {
    render(<AdminLideUcty />);
    fireEvent.click(screen.getByText("admin.people.persons.assign"));
    const dialog = await screen.findByRole("listbox");
    fireEvent.click(within(dialog).getByText("Jan Novák"));
    fireEvent.click(screen.getByText("admin.people.assign.confirm"));
    expect(s.mutate).toHaveBeenCalledWith({ userId: "u-1", twinId: "t-1" }, expect.anything());
  });

  it("přiřazení od účtu: nabídne osoby bez účtu", async () => {
    render(<AdminLideUcty />);
    fireEvent.click(screen.getByText("admin.people.accounts.assign"));
    const dialog = await screen.findByRole("listbox");
    fireEvent.click(within(dialog).getByText("KOŽUŠNÍK Petr"));
    fireEvent.click(screen.getByText("admin.people.assign.confirm"));
    expect(s.mutate).toHaveBeenCalledWith({ userId: "u-1", twinId: "t-1" }, expect.anything());
  });

  it("⛔ osoba s jiným účtem → vysvětlující hláška, ne obecná chyba", async () => {
    s.mutate.mockImplementation((_v, o: { onError: (e: Error) => void }) => o.onError(new OsobaMaJinyUcet()));
    render(<AdminLideUcty />);
    fireEvent.click(screen.getByText("admin.people.persons.assign"));
    fireEvent.click(within(await screen.findByRole("listbox")).getByText("Jan Novák"));
    fireEvent.click(screen.getByText("admin.people.assign.confirm"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("admin.people.assign.otherAccount"));
  });

  it("uříznutý seznam to řekne", () => {
    s.osoby = { items: [OSOBA], count: 1, limitovano: true };
    render(<AdminLideUcty />);
    expect(screen.getByText("admin.people.limited")).toBeTruthy();
  });

  it("sjednocení: vratné rozhodnutí nabídne Vrátit (s důvodem), vrácené ukáže štítek", async () => {
    s.rozhodnuti = [
      { decision_id: "d-1", akce: "twin.person_unified", kdy: "2026-09-23T10:00:00Z", souhrn: "Sjednocení osoby (driver): 2 úlomků", duvod: "x", vratne: true, vraceno: null },
      { decision_id: "d-2", akce: "twin.person_unified", kdy: "2026-09-22T10:00:00Z", souhrn: "Starší", duvod: "y", vratne: false, vraceno: { kdy: "2026-09-22T11:00:00Z" } },
    ];
    render(<AdminLideUcty />);
    expect(screen.getByText("admin.people.decisions.reverted")).toBeTruthy();
    fireEvent.click(screen.getByText("admin.people.decisions.revert"));
    const potvrdit = await screen.findByText("admin.people.decisions.revertConfirm");
    // Bez důvodu se vrátit nedá.
    expect((potvrdit.closest("button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("admin.people.decisions.reason"), { target: { value: "omyl" } });
    fireEvent.click(potvrdit);
    expect(s.vratit).toHaveBeenCalledWith({ decisionId: "d-1", duvod: "omyl" }, expect.anything());
  });

  it("⛔ nabídka druhů je z dat — „driver“ v ní je, i když načtená stránka nese jen firmy", () => {
    // Přesně stav produkce 2026-09-23: abecedně první osoby bez účtu byly firmy.
    s.osoby = {
      items: [{ ...OSOBA, twin_id: "c-1", twin_label: "ABC s.r.o.", entity_type: "company", kroky: null }],
      count: 1,
      limitovano: true,
    };
    render(<AdminLideUcty />);
    const volby = [...(screen.getByLabelText("admin.people.persons.type") as HTMLSelectElement).options].map((o) => o.value);
    expect(volby).toEqual(["", "company", "driver"]);
  });

  it("sekce účtu: nabídne udělitelné sekce a přepnutí jde do mutace s tímhle účtem", async () => {
    render(<AdminLideUcty />);
    fireEvent.click(screen.getAllByLabelText("admin.people.sections.action")[0]);
    const prepinac = await screen.findByRole("switch");
    expect(screen.getByText("app.nav.smlouvy")).toBeTruthy();
    fireEvent.click(prepinac);
    expect(s.udelit).toHaveBeenCalledWith({ userId: "u-1", surface: "smlouvy", udelit: true }, expect.anything());
  });

  it("vazby na data: ukáže vazby, přidání identity a odebrání jdou do mutací s tímhle účtem", async () => {
    render(<AdminLideUcty />);
    fireEvent.click(screen.getAllByLabelText("admin.people.bindings.action")[0]);
    expect(await screen.findByText("Moravská nemovitostní")).toBeTruthy();
    expect(screen.getByText("admin.people.bindings.noIdentifier")).toBeTruthy();
    fireEvent.click(screen.getByText("admin.people.bindings.add"));
    expect(s.priraditIdentitu).toHaveBeenCalledWith({ relationKind: "spravuje", twinId: "t-av", userId: "u-1" }, expect.anything());
    fireEvent.click(screen.getByLabelText("admin.people.bindings.remove"));
    expect(s.odebratIdentitu).toHaveBeenCalledWith({ relationId: "rel-1", userId: "u-1" }, expect.anything());
  });

  it("zdroje dat: ukáže instance z dat se stavem a přepnutí jde do mutace s tímhle účtem", async () => {
    render(<AdminLideUcty />);
    fireEvent.click(screen.getAllByLabelText("admin.people.sources.action")[0]);
    expect(await screen.findByText("money/Areál Avant Ďáblická")).toBeTruthy();
    expect(screen.getByText("admin.people.sources.none")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("money/Areál Avant Ďáblická", { exact: false }));
    expect(s.udelitZdroj).toHaveBeenCalledWith(
      { userId: "u-1", zdroj: "instance:money/Areál Avant Ďáblická", udelit: true }, expect.anything());
  });

  it("zdroje dat: firmu podle IČO jde najít a udělit", async () => {
    render(<AdminLideUcty />);
    fireEvent.click(screen.getAllByLabelText("admin.people.sources.action")[0]);
    fireEvent.change(await screen.findByLabelText("admin.people.sources.firmsSearch"), { target: { value: "2828" } });
    fireEvent.click(screen.getByLabelText("Moravská nemovitostní a.s.", { exact: false }));
    expect(s.udelitZdroj).toHaveBeenCalledWith({ userId: "u-1", zdroj: "firma:28282264", udelit: true }, expect.anything());
  });

  it("zdroje dat: plný přístup jedním přepínačem jde do mutace jako vse:*", async () => {
    render(<AdminLideUcty />);
    fireEvent.click(screen.getAllByLabelText("admin.people.sources.action")[0]);
    fireEvent.click(await screen.findByLabelText("admin.people.sources.all", { exact: false }));
    expect(s.udelitZdroj).toHaveBeenCalledWith({ userId: "u-1", zdroj: "vse:*", udelit: true }, expect.anything());
  });

  it("zdroje dat po druzích: dokumenty vstupu a zdroj dvojčat jdou do mutace samostatně", async () => {
    render(<AdminLideUcty />);
    fireEvent.click(screen.getAllByLabelText("admin.people.sources.action")[0]);
    fireEvent.click(await screen.findByLabelText("dokumenty", { exact: false }));
    expect(s.udelitZdroj).toHaveBeenCalledWith({ userId: "u-1", zdroj: "vstup:dokumenty", udelit: true }, expect.anything());
    fireEvent.click(screen.getByLabelText("sez-vyuctovani", { exact: false }));
    expect(s.udelitZdroj).toHaveBeenCalledWith({ userId: "u-1", zdroj: "udalosti:sez-vyuctovani", udelit: true }, expect.anything());
  });
});

