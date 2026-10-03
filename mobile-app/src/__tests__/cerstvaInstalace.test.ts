import AsyncStorage from "@react-native-async-storage/async-storage";
import { jePrvniBehPoInstalaci, oznacInstalaci } from "@/lib/cerstvaInstalace";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

const ulozene = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
};

describe("čerstvá instalace", () => {
  beforeEach(() => jest.clearAllMocks());

  it("bez značky = první běh (a tedy relace z minulé instalace)", async () => {
    // Keychain relaci přežije, AsyncStorage ne — chybějící značka je JEDINÝ
    // signál, že relace patří k instalaci, která už neexistuje.
    ulozene.getItem.mockResolvedValue(null);
    expect(await jePrvniBehPoInstalaci()).toBe(true);
  });

  it("se značkou = běžný start, nic se neuklízí", async () => {
    ulozene.getItem.mockResolvedValue("2026-09-01T00:00:00.000Z");
    expect(await jePrvniBehPoInstalaci()).toBe(false);
  });

  it("nečitelné úložiště NEZAHODÍ přihlášení (fail-closed k úklidu)", async () => {
    // Vyhodit člověka kvůli rozbitému AsyncStorage by bylo horší než ponechat
    // relaci — tu stejně prověří první požadavek na API.
    ulozene.getItem.mockRejectedValue(new Error("storage mimo provoz"));
    expect(await jePrvniBehPoInstalaci()).toBe(false);
  });

  it("značka se zapíše a nese čas", async () => {
    ulozene.setItem.mockResolvedValue(undefined);
    await oznacInstalaci();
    expect(ulozene.setItem).toHaveBeenCalledTimes(1);
    const [, hodnota] = ulozene.setItem.mock.calls[0];
    expect(Number.isNaN(Date.parse(hodnota))).toBe(false);
  });

  it("selhání zápisu značky NESHODÍ start appky", async () => {
    ulozene.setItem.mockRejectedValue(new Error("plno"));
    await expect(oznacInstalaci()).resolves.toBeUndefined();
  });
});
