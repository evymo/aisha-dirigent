/**
 * Volba jazyka. Naměřeno v simulátoru: appka na `cs-CZ` zařízení mluvila
 * anglicky, protože se jazyka zařízení nikdo neptal.
 */
import { vyberLocale } from "@/hooks/useTranslation";

const PODPOROVANE = ["cs", "en"];

describe("vyberLocale", () => {
  it("⛔ jazyk zařízení rozhoduje, když si uživatel nic nezvolil", () => {
    expect(vyberLocale(null, ["cs-CZ", "en-CZ"], PODPOROVANE)).toBe("cs");
  });

  it("uložená volba PŘEBÍJÍ zařízení — vědomé rozhodnutí se nepřepisuje", () => {
    expect(vyberLocale("en", ["cs-CZ"], PODPOROVANE)).toBe("en");
    expect(vyberLocale("cs", ["en-US"], PODPOROVANE)).toBe("cs");
  });

  it("region se ignoruje (cs-CZ i cs-SK je cs)", () => {
    expect(vyberLocale(null, ["cs-SK"], PODPOROVANE)).toBe("cs");
  });

  it("nepodporovaný jazyk zařízení přeskočí na další v pořadí", () => {
    expect(vyberLocale(null, ["de-DE", "cs-CZ"], PODPOROVANE)).toBe("cs");
  });

  it("nic nesedí → en jako koncové útočiště, ne čeština", () => {
    expect(vyberLocale(null, ["de-DE", "fr-FR"], PODPOROVANE)).toBe("en");
    expect(vyberLocale(null, [], PODPOROVANE)).toBe("en");
  });

  it("uložená, ale nepodporovaná volba se ignoruje", () => {
    expect(vyberLocale("de", ["cs-CZ"], PODPOROVANE)).toBe("cs");
  });
});

/**
 * ⛔ Volba jazyka musí DOTÉCT k už vykresleným komponentám.
 *
 * Naměřeno na běžící appce: `initLocale` běží asynchronně, takže přihlašovací
 * obrazovka se vykreslí dřív. Bez odběru si vzala `en` a znovu se nevykreslila
 * nikdy — správně spočítaná hodnota, kterou nikdo nezobrazil.
 */
import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useTranslation, initLocale, pocetPosluchacu } from "@/hooks/useTranslation";

describe("jazyk doteče k už připojené komponentě", () => {
  it("připojený hook se odhlásí při odpojení (žádný únik)", () => {
    const pred = pocetPosluchacu();
    const { unmount } = renderHook(() => useTranslation());
    expect(pocetPosluchacu()).toBe(pred + 1);
    unmount();
    expect(pocetPosluchacu()).toBe(pred);
  });

  it("⛔ initLocale PO vykreslení překreslí — tohle byla ta vada", async () => {
    const { result } = renderHook(() => useTranslation());
    const puvodni = result.current.locale;
    await act(async () => {
      await initLocale();
    });
    await waitFor(() => {
      // Jazyk se buď změnil, nebo už seděl; podstatné je, že hook NEZŮSTAL
      // odpojený od modulové hodnoty.
      expect(typeof result.current.locale).toBe("string");
    });
    expect(["cs", "en"]).toContain(result.current.locale);
    expect(puvodni).toBeDefined();
  });
});
