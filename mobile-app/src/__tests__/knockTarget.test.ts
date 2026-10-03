/**
 * Kam se ťuká — a kdy se ťukat NESMÍ.
 *
 * Vlastnost: chybějící údaj znamená STOP a pojmenování, ne dosazení. Dveře mlčí
 * i při úspěchu, takže zaťukání na uhodnutou adresu vypadá stejně jako zaťukání
 * správné — tedy nijak. Dosazená „rozumná" hodnota by z toho udělala poruchu
 * nerozeznatelnou od zavřených dveří a člověk by donekonečna psal správný kód
 * do špatných dveří.
 */
import { lzeZaklepat, resolveKnockTarget, apiUrlOdSpravce } from "@/config/knock";
import cs from "@/i18n/cs.json";
import en from "@/i18n/en.json";

const extra: Record<string, unknown> = {};
/** Co „dal správce zařízení" — u nás hlídač přes řízenou konfiguraci. */
let mockOdSpravce: Record<string, string> = {};

jest.mock("../../modules/rizena-konfigurace", () => ({
  __esModule: true,
  rizenaKonfigurace: () => mockOdSpravce,
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra };
    },
  },
}));

function nastav(hodnoty: Record<string, unknown>, spravce: Record<string, string> = {}) {
  for (const k of Object.keys(extra)) delete extra[k];
  Object.assign(extra, hodnoty);
  mockOdSpravce = spravce;
}

const OD_SPRAVCE = {
  "platforma.hlidac.API_URL": "https://api.tablet.example",
  "platforma.hlidac.KNOCK_HOST": "dvere.tablet.example",
  "platforma.hlidac.KNOCK_PORT": "62201",
  "platforma.hlidac.KNOCK_KID": "dev-abc123",
  "platforma.hlidac.KNOCK_SCOPE": "ridic",
};

const UPLNE = {
  EXPO_PUBLIC_KNOCK_HOST: "dvere.example",
  EXPO_PUBLIC_KNOCK_PORT: "18181",
  EXPO_PUBLIC_KNOCK_KID: "ops-zdenek",
  EXPO_PUBLIC_KNOCK_SCOPE: "ops",
};

describe("resolveKnockTarget", () => {
  it("úplná konfigurace dá cíl a port jako číslo", () => {
    nastav(UPLNE);
    const { target, chybi } = resolveKnockTarget();
    expect(chybi).toEqual([]);
    expect(target).toEqual({ host: "dvere.example", kid: "ops-zdenek", port: 18181, scope: "ops" });
    expect(lzeZaklepat()).toBe(true);
  });

  it.each([
    ["EXPO_PUBLIC_KNOCK_HOST"],
    ["EXPO_PUBLIC_KNOCK_PORT"],
    ["EXPO_PUBLIC_KNOCK_KID"],
    ["EXPO_PUBLIC_KNOCK_SCOPE"],
  ])("bez %s se NEŤUKÁ a řekne se, co chybí", (klic) => {
    const bez = { ...UPLNE };
    delete (bez as Record<string, unknown>)[klic];
    nastav(bez);

    const { target, chybi } = resolveKnockTarget();
    expect(target).toBeNull();
    expect(chybi).toContain(klic);
    expect(lzeZaklepat()).toBe(false);
  });

  it("nečíselný port je CHYBĚJÍCÍ údaj, ne důvod dosadit 18181", () => {
    nastav({ ...UPLNE, EXPO_PUBLIC_KNOCK_PORT: "brzy" });
    const { target, chybi } = resolveKnockTarget();
    expect(target).toBeNull();
    expect(chybi).toEqual(["EXPO_PUBLIC_KNOCK_PORT"]);
  });

  it("port mimo rozsah se odmítne (0 i 65536)", () => {
    for (const port of ["0", "65536", "-1"]) {
      nastav({ ...UPLNE, EXPO_PUBLIC_KNOCK_PORT: port });
      expect(resolveKnockTarget().target).toBeNull();
    }
  });

  it("prázdný řetězec se počítá jako chybějící, ne jako hodnota", () => {
    nastav({ ...UPLNE, EXPO_PUBLIC_KNOCK_SCOPE: "" });
    expect(resolveKnockTarget().chybi).toContain("EXPO_PUBLIC_KNOCK_SCOPE");
  });

  /**
   * ⛔ ZÁMĚNA, KTEROU MAJITEL PŘISTIHL (2026-08-20): funkce se jmenovala
   * `maDvere()` a hláška zněla „Tahle aplikace dveře nemá". Obojí tvrdilo něco
   * o SVĚTĚ podle toho, co víme o SOBĚ.
   *
   * Appka nemůže vědět, jestli někde dveře jsou, a nikdy nebude moci: dveře
   * MLČÍ i při úspěchu, takže se nedá zeptat, jen zkusit. Chybějící údaje
   * znamenají „nemám čím zaťukat", ne „dveře nejsou".
   *
   * Měří se i TEXT, protože přesně tudy se ta záměna vrátila.
   */
  it("⛔ mluví o vlastní výbavě, ne o existenci dveří", () => {
    nastav({});
    expect(lzeZaklepat()).toBe(false);
    // ⚠️ Jest nebere druhý argument `expect` (to umí vitest v kořenových
    // bránách) — důvod proto v komentáři, ne ve zprávě.
    // Hláška nesmí tvrdit nic o EXISTENCI dveří, jen o tom, co máme my.
    for (const katalog of [cs, en]) {
      const hlaska = (katalog as { knock: { not_configured: string } }).knock.not_configured;
      expect(hlaska).not.toMatch(/dveře\s+(ne)?má|žádné dveře|has no door|no door/i);
    }
  });

  it("chybí-li všechno, vyjmenují se všechny čtyři — ne jen první", () => {
    nastav({});
    expect(resolveKnockTarget().chybi).toHaveLength(4);
  });
});

/**
 * Výbava od správce zařízení (hlídač), ne ze sestavení.
 *
 * ⭐ ZADÁNÍ MAJITELE (2026-09-22): „tím pádem by nám ani nemohl nikdo klepat na
 * dveře, protože by jen s appkou ve store nevěděl jak." Stejné APK z Obchodu
 * Play dveře nezná — výbavu dostane až na zavedeném tabletu.
 */
describe("výbava od správce zařízení", () => {
  it("bez zapečených hodnot appka z Obchodu Play zaťukat NEUMÍ", () => {
    nastav({});
    expect(lzeZaklepat()).toBe(false);
  });

  it("na zavedeném tabletu dveře zná, i když v sestavení nejsou", () => {
    nastav({}, OD_SPRAVCE);
    const { target, chybi } = resolveKnockTarget();
    expect(chybi).toEqual([]);
    expect(target).toEqual({ host: "dvere.tablet.example", port: 62201, kid: "dev-abc123", scope: "ridic" });
  });

  it("⛔ správce PŘEBIJE ADRESU sestavení — jinak by změna adresy vyžadovala nový build", () => {
    nastav(UPLNE, OD_SPRAVCE);
    expect(resolveKnockTarget().target).toMatchObject({ host: "dvere.tablet.example", port: 62201, scope: "ridic" });
  });

  it("⛔ `kid` pro kód je ze sestavení — zastaralý `kid` z QR ho nepřebije", () => {
    // Výbava Kiosk Adminu je z jednorázového QR a obnovit nejde (Play Protect
    // blokuje nové zavedení i aktualizaci Kiosk Adminu). NAMĚŘENO 29. 9.: kód
    // technika pod kid z výbavy = bad-hmac, pod kid z dat instance projde.
    nastav(UPLNE, OD_SPRAVCE);
    expect(resolveKnockTarget().target).toMatchObject({ kid: "ops-zdenek" });
  });

  it("⛔ ČÁSTEČNÁ sada od správce se NEMÍCHÁ se sestavením", () => {
    // Host od správce a `kid` ze sestavení by vyrobily klíč, který u dveří
    // skončí na `unknown-kid` — tedy mlčením, nerozeznatelným od úspěchu.
    const pulka = { ...OD_SPRAVCE };
    delete (pulka as Record<string, string>)["platforma.hlidac.KNOCK_KID"];
    nastav(UPLNE, pulka);
    expect(resolveKnockTarget().target).toMatchObject({ host: "dvere.example", kid: "ops-zdenek" });
  });

  it("adresa platformy je vidět jen od správce", () => {
    nastav({});
    expect(apiUrlOdSpravce()).toBeNull();
    nastav({}, OD_SPRAVCE);
    expect(apiUrlOdSpravce()).toBe("https://api.tablet.example");
  });
});
