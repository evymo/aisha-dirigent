/**
 * Ohnisko appky — kdy se data mají obnovit.
 *
 * ⛔ Měří se to, co je tvrzení o CIZÍ PLATFORMĚ: které stavy `AppState` znamenají
 * „člověk se dívá". Právě tam se dělá chyba, která se v terénu projeví jako
 * obnova při každém příchozím hovoru — nebo naopak jako data z rána.
 */
import { jeVPopredi } from "@/lib/oziveni";

describe("v popředí", () => {
  it("`active` = člověk se dívá", () => {
    expect(jeVPopredi("active")).toBe(true);
  });

  it.each(["background", "inactive"] as const)(
    "⛔ `%s` NENÍ popředí — přepínač úloh ani příchozí hovor nejsou návrat k appce",
    (stav) => {
      expect(jeVPopredi(stav)).toBe(false);
    });

  it("⛔ neznámý stav platformy se bere jako NE — obnova naslepo pálí data řidiče", () => {
    // `AppState` má na Androidu navíc `extension`; budoucí stavy jsou možné.
    expect(jeVPopredi("extension" as never)).toBe(false);
  });
});
