/**
 * Sjednocení osoby: „Sjednotit" až po náhledu PRÁVĚ pro vybrané záznamy;
 * odmítnutí serveru dostane vysvětlující hlášku.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/hooks/useDebounce", () => ({ useDebounce: <T,>(v: T) => v }));

const POCTY = { vazeb_presunout: 4, vazeb_ukoncit: 1, kroku_prepojit: 2, kroku_hotovych_zustava: 9, zaznamu_archivovat: 2, relaci_zustava: 0 };
const osoba = (id: string, label: string) => ({
  twin_id: id, twin_label: label, entity_type: "driver", refs: [], pozvanky: [], navrhy_uctu: [], kroky: { celkem: 3, ceka: 1 },
});

const s = vi.hoisted(() => ({ mutate: vi.fn(), hledano: [] as string[] }));
vi.mock("@/hooks/useHrLideUcty", () => {
  class OdmitnutiMock extends Error {
    constructor(public kod: string) { super(kod); }
  }
  return {
    OdmitnutiSjednoceni: OdmitnutiMock,
    useOsobyBezUctu: (h: string) => {
      s.hledano.push(h);
      return { data: { items: [osoba("k", "KOŽUŠNÍK Petr"), osoba("f1", "p. Kožušník"), osoba("f2", "Kozusnik 1AB2345")], count: 3, limitovano: false } };
    },
    useSjednotitOsobu: () => ({ mutate: s.mutate, isPending: false }),
  };
});

import { SjednotitOsobu } from "@/components/admin/lide/SjednotitOsobu";
import { vychoziHledani } from "@/lib/hr/jmena";
import { OdmitnutiSjednoceni } from "@/hooks/useHrLideUcty";

const KANON = { twin_id: "k", label: "KOŽUŠNÍK Petr", entity_type: "driver" };
const tlacitko = (k: string) => screen.getByText(k).closest("button") as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  s.hledano = [];
});

describe("SjednotitOsobu", () => {
  it("výchozí hledání = nejdelší slovo jména (bez „p.“ a SPZ)", () => {
    expect(vychoziHledani("KOŽUŠNÍK Petr")).toBe("KOŽUŠNÍK");
    expect(vychoziHledani("p. Kožušník 1AB2345")).toBe("Kožušník");
  });

  it("kanon se nenabízí; hledá se jen ve stejném druhu", () => {
    render(<SjednotitOsobu kanon={KANON} onZavrit={() => {}} />);
    expect(screen.queryByText("KOŽUŠNÍK Petr", { selector: "span" })).toBeNull();
    expect(screen.getByText("p. Kožušník")).toBeTruthy();
    expect(s.hledano[0]).toBe("KOŽUŠNÍK");
  });

  it("⛔ Sjednotit až po náhledu — a změna výběru náhled zneplatní", () => {
    s.mutate.mockImplementation((v: { nahled: boolean }, o: { onSuccess: (r: unknown) => void }) => {
      if (v.nahled) o.onSuccess({ ok: true, dry_run: true, pocty: POCTY });
    });
    render(<SjednotitOsobu kanon={KANON} onZavrit={() => {}} />);
    fireEvent.click(screen.getByText("p. Kožušník"));
    expect(tlacitko("admin.people.merge.apply").disabled).toBe(true);
    fireEvent.click(screen.getByText("admin.people.merge.preview"));
    expect(s.mutate).toHaveBeenLastCalledWith({ kanon: "k", ulomky: ["f1"], nahled: true }, expect.anything());
    expect(screen.getByRole("status")).toBeTruthy();
    expect(tlacitko("admin.people.merge.apply").disabled).toBe(false);
    fireEvent.click(screen.getByText("Kozusnik 1AB2345"));
    expect(tlacitko("admin.people.merge.apply").disabled).toBe(true);
  });

  it("ostrý běh posílá výběr a důvod", () => {
    s.mutate.mockImplementation((v: { nahled: boolean }, o: { onSuccess: (r: unknown) => void }) => {
      o.onSuccess({ ok: true, dry_run: v.nahled, pocty: POCTY, decision_id: "d" });
    });
    const zavrit = vi.fn();
    render(<SjednotitOsobu kanon={KANON} onZavrit={zavrit} />);
    fireEvent.click(screen.getByText("admin.people.merge.selectAll"));
    fireEvent.click(screen.getByText("admin.people.merge.preview"));
    fireEvent.click(screen.getByText("admin.people.merge.apply"));
    const posledni = s.mutate.mock.calls.at(-1)?.[0] as { ulomky: string[]; nahled: boolean; duvod: string };
    expect(posledni.nahled).toBe(false);
    expect([...posledni.ulomky].sort()).toEqual(["f1", "f2"]);
    expect(posledni.duvod).toBe("admin.people.merge.defaultReason");
    expect(zavrit).toHaveBeenCalled();
  });

  it("⛔ úlomek s účtem → vysvětlující hláška", async () => {
    s.mutate.mockImplementation((_v: unknown, o: { onError: (e: Error) => void }) => o.onError(new OdmitnutiSjednoceni("ulomek_ma_ucet")));
    render(<SjednotitOsobu kanon={KANON} onZavrit={() => {}} />);
    fireEvent.click(screen.getByText("p. Kožušník"));
    fireEvent.click(screen.getByText("admin.people.merge.preview"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("admin.people.merge.errors.hasAccount"));
  });
});
