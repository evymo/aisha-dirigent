/**
 * Poloha tabletu u potvrzení předání — metainformace, která NESMÍ zastavit práci.
 *
 * Testy pojmenovávají VLASTNOST: chybějící poloha je poctivá mezera s důvodem,
 * nikdy výjimka; stará poloha se netváří jako měření.
 */
import { zjistiPolohuPredani, type NamerenaPoloha, type PolohaDeps } from "@/lib/polohaZarizeni";

jest.mock("@/lib/security/safeLogger", () => ({
  safeError: jest.fn(),
  safeInfo: jest.fn(),
  safeWarn: jest.fn(),
}));

const T = Date.UTC(2026, 8, 18, 10, 0, 0);
const mereni = (o: Partial<NamerenaPoloha> = {}): NamerenaPoloha => ({
  lat: 50.08,
  lon: 14.42,
  accuracy: 12,
  timestamp: T,
  ...o,
});

function deps(o: Partial<PolohaDeps> = {}): PolohaDeps {
  return {
    opravneni: jest.fn(async () => "granted" as const),
    sluzbyZapnute: jest.fn(async () => true),
    aktualni: jest.fn(async () => mereni()),
    posledniZnama: jest.fn(async () => null),
    ...o,
  };
}

describe("poloha u předání", () => {
  it("čerstvé měření jde do evidence s časem MĚŘENÍ", async () => {
    await expect(zjistiPolohuPredani(deps())).resolves.toEqual({
      lat: 50.08,
      lon: 14.42,
      accuracy_m: 12,
      captured_at: "2026-09-18T10:00:00.000Z",
    });
  });

  it("bez oprávnění se na GPS ani nesáhne", async () => {
    const d = deps({ opravneni: jest.fn(async () => "denied" as const) });
    await expect(zjistiPolohuPredani(d)).resolves.toEqual({ unavailable: "denied" });
    expect(d.aktualni).not.toHaveBeenCalled();
  });

  it("vypnuté služby = disabled, ne timeout", async () => {
    const d = deps({ sluzbyZapnute: jest.fn(async () => false) });
    await expect(zjistiPolohuPredani(d)).resolves.toEqual({ unavailable: "disabled" });
    expect(d.aktualni).not.toHaveBeenCalled();
  });

  it("když čerstvé měření nepřijde, vezme se poslední známá — jen dost mladá", async () => {
    const d = deps({
      aktualni: jest.fn(async () => null),
      posledniZnama: jest.fn(async () => mereni({ lat: 49.2 })),
    });
    const r = await zjistiPolohuPredani(d, { timeoutMs: 5000, maxStariMs: 60_000 });
    expect(r).toMatchObject({ lat: 49.2 });
    expect(d.aktualni).toHaveBeenCalledWith(5000);
    expect(d.posledniZnama).toHaveBeenCalledWith(60_000);
  });

  it("nesmyslné souřadnice se nepošlou jako měření", async () => {
    const d = deps({ aktualni: jest.fn(async () => mereni({ lat: Number.NaN })) });
    await expect(zjistiPolohuPredani(d)).resolves.toEqual({ unavailable: "timeout" });
  });

  it("nic nepřišlo = timeout, poctivá mezera", async () => {
    const d = deps({ aktualni: jest.fn(async () => null) });
    await expect(zjistiPolohuPredani(d)).resolves.toEqual({ unavailable: "timeout" });
  });

  it("⛔ výjimka z nativní vrstvy předání NEZASTAVÍ", async () => {
    const d = deps({ aktualni: jest.fn(async () => { throw new Error("Location provider is unavailable"); }) });
    await expect(zjistiPolohuPredani(d)).resolves.toEqual({ unavailable: "error" });
  });

  it("neplatná přesnost se nevymýšlí — zůstane null", async () => {
    const d = deps({ aktualni: jest.fn(async () => mereni({ accuracy: -1 })) });
    await expect(zjistiPolohuPredani(d)).resolves.toMatchObject({ accuracy_m: null });
  });
});
