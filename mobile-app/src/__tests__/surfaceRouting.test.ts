/**
 * Surface routing — brand default × role decides the post-login landing.
 *
 * ⭐ Od 2026-08-19 je `brand.defaultSurface` OTEVŘENÝ: rezervované je jediné
 * slovo `tabs`, cokoli jiného je slug extranetové sekce. Bez toho nešlo vydat
 * appku řidiče (`vyvoz`) ani miniappku na odečty (`meridla`) jinak než změnou
 * kódu platformy — přestože sekce je otevřený text v databázi.
 */
import { isAdminOrStaff, resolveLandingRoute, brandDefaultSurface, TABS } from "@/extranet/surfaceRouting";

const mockExtra: { AISHA_DEFAULT_SURFACE?: string } = {};
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { get expoConfig() { return { extra: mockExtra }; } },
}));

describe("surfaceRouting", () => {
  beforeEach(() => {
    delete mockExtra.AISHA_DEFAULT_SURFACE;
  });

  it("isAdminOrStaff matches admin or staff only", () => {
    expect(isAdminOrStaff(["member"])).toBe(false);
    expect(isAdminOrStaff(["staff"])).toBe(true);
    expect(isAdminOrStaff(["admin", "member"])).toBe(true);
    expect(isAdminOrStaff(undefined)).toBe(false);
  });

  it("AISHA build (default 'tabs') → everyone lands on tabs", () => {
    expect(resolveLandingRoute(["member"])).toBe("/(tabs)");
    expect(resolveLandingRoute(["admin"])).toBe("/(tabs)");
    expect(resolveLandingRoute(undefined)).toBe("/(tabs)");
  });

  it("porada build → non-admin/staff land on Porada, admin/staff on tabs", () => {
    mockExtra.AISHA_DEFAULT_SURFACE = "porada";
    expect(resolveLandingRoute(["member"])).toEqual({ pathname: "/porada", params: { surface: "porada" } });
    expect(resolveLandingRoute([])).toEqual({ pathname: "/porada", params: { surface: "porada" } });
    expect(resolveLandingRoute(undefined)).toEqual({ pathname: "/porada", params: { surface: "porada" } });
    expect(resolveLandingRoute(["staff"])).toBe("/(tabs)");
    expect(resolveLandingRoute(["admin", "member"])).toBe("/(tabs)");
  });

  /**
   * ⭐ VĚTA, KVŮLI KTERÉ TENHLE ŠEV VZNIKL. Do 2026-08-19 tady stálo, že
   * neznámá hodnota padá na taby — což bylo doslova jediné, co uzavřená unie
   * uměla, a co znemožňovalo dedikovanou appku. Sekce je otevřený text v DB;
   * klient jich nesmí znát pevný počet.
   */
  it("kterýkoli slug sekce je platná přistávací plocha, ne 'neznámá hodnota'", () => {
    mockExtra.AISHA_DEFAULT_SURFACE = "vyvoz";
    expect(resolveLandingRoute(["member"])).toEqual({ pathname: "/porada", params: { surface: "vyvoz" } });
    mockExtra.AISHA_DEFAULT_SURFACE = "meridla";
    expect(resolveLandingRoute(["member"])).toEqual({ pathname: "/porada", params: { surface: "meridla" } });
  });

  it("admin/staff dostanou taby i v dedikovaném buildu — platformu řídí oni", () => {
    mockExtra.AISHA_DEFAULT_SURFACE = "vyvoz";
    expect(resolveLandingRoute(["admin"])).toBe("/(tabs)");
    expect(resolveLandingRoute(["staff", "member"])).toBe("/(tabs)");
  });

  /**
   * Prázdná hodnota je TÁŽ VĚC jako chybějící, ne třetí stav — jinak by se do
   * routeru poslala sekce beze jména a appka by se ptala na prázdno.
   */
  it("prázdná nebo nesmyslně typovaná hodnota = taby", () => {
    mockExtra.AISHA_DEFAULT_SURFACE = "";
    expect(brandDefaultSurface()).toBe(TABS);
    expect(resolveLandingRoute(["member"])).toBe("/(tabs)");
    mockExtra.AISHA_DEFAULT_SURFACE = "   ";
    expect(resolveLandingRoute(["member"])).toBe("/(tabs)");
    (mockExtra as { AISHA_DEFAULT_SURFACE?: unknown }).AISHA_DEFAULT_SURFACE = 42;
    expect(resolveLandingRoute(["member"])).toBe("/(tabs)");
  });

  it("slug se ořízne — mezera v profilu nesmí vyrobit jinou sekci", () => {
    mockExtra.AISHA_DEFAULT_SURFACE = "  vyvoz  ";
    expect(brandDefaultSurface()).toBe("vyvoz");
  });
});
