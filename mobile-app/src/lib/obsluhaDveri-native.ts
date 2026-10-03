/**
 * Sestavení žebříčku ke dveřím pro běh na telefonu.
 *
 * ⛔ PROČ TO NENÍ V `knock-native.ts`. Hranice, kterou tenhle soubor drží, je
 * „automatika NEZAKLÁDÁ průkaz" — a hranice, která se nedá změřit, se nedá
 * udržet. Dokud automatické i lidské sestavení bydlely v jednom souboru, šlo
 * měřit jen dovoz celého souboru, a ten musí `povereniZarizeni` (zakládající)
 * obsahovat kvůli zavedení zařízení. Rozdělením se z pravidla stala VLASTNOST
 * SOUBORU: tenhle nesmí zakládající funkci dovézt vůbec. Hlídá to brána
 * v `__tests__/obsluhaDveri.test.ts` a je mutací doložená.
 *
 * ⭐ Nativní moduly se odsud NELINKUJÍ — berou se hotové z `knock-native.ts`,
 * které zůstává jediným místem, kde `react-native-quick-crypto`,
 * `react-native-udp` a `expo-secure-store` do appky vstupují.
 */
import { nactiPovereni } from "./poverovani-zarizeni";
import { knockAsDevice } from "./knock";
import { pametPokusu, type ObsluhaDveriDeps, type PametPokusu } from "./obsluhaDveri";
import { nativeKnockDeps, nativeKryptoZarizeni, nativeUlozisteKlicu } from "./knock-native";
import { resolveKnockTarget } from "../config/knock";
import { checkBackendHealth, getBackendUrl } from "../config/api";
import type { SamoKlepaniDeps } from "./samoKlepaniKiosku";

/**
 * JEDNA paměť pokusu na celou appku.
 *
 * ⛔ Modulová proměnná je tu ZÁMĚR, ne lenost. Kdyby si každá obrazovka držela
 * vlastní, jeden výpadek by vyrobil tolik automatických zaťukání, kolik
 * obrazovek zrovna něco odesílá — a `SPA_MAX_INVALID` (10 / 60 s, cooldown
 * 300 s) by z toho udělal zavřené dveře. `dvereEskalace.ts` říká „nejvýš jedno
 * zaťukání na pokus"; aby to platilo, musí být pokus jeden pro celou appku.
 */
const pamet: PametPokusu = pametPokusu();

/**
 * ⛔ CHYBĚJÍCÍ CÍL SE HLÁSÍ JAKO NEÚSPĚŠNÉ ZAŤUKÁNÍ, ne jako „nemám průkaz".
 * Průkaz zařízení a znalost adresy jsou dvě různé věci a splynout nesmí: bez
 * adresy neprojde ani RUČNÍ kód, a člověk musí dostat jména nedeklarovaných
 * hodnot, ne hlášku „zařízení není schválené". Klepátko je pak vypíše.
 */
export function nativeObsluhaDveri(): ObsluhaDveriDeps {
  return {
    nactiPovereni: () => nactiPovereni(nativeUlozisteKlicu()),
    zatukejZarizenim: async (p) => {
      const { target, chybi } = resolveKnockTarget();
      if (target === null)
        return { sent: false, kid: p.kid, error: `chybí konfigurace dveří: ${chybi.join(", ")}` };
      const krypto = nativeKryptoZarizeni();
      return knockAsDevice(
        { kid: p.kid, podepis: (zprava) => krypto.podepis(p.privateKeyPem, zprava) },
        // ⛔ SCOPE Z PRŮKAZU, NE Z KONFIGURACE. Roster schvaloval TENHLE scope;
        // hodnota ze sestavení se může aktualizací změnit a zařízení by pak mlčky
        // padalo na `scope-denied`, což zvenčí vypadá jako zavřené dveře.
        { host: target.host, port: target.port, scope: p.scope },
        nativeKnockDeps(),
      );
    },
    pamet,
  };
}

/**
 * Hlídka dveří tabletu v kiosku (`samoKlepaniKiosku.ts`). Tytéž dvě operace jako
 * reaktivní cesta výš — průkaz se jen ČTE, klepe se VER 2 rámcem s jeho scope.
 */
export function nativeSamoKlepaniDeps(): SamoKlepaniDeps {
  const obsluha = nativeObsluhaDveri();
  return {
    dosazitelne: async () => checkBackendHealth(await getBackendUrl()),
    nactiPovereni: obsluha.nactiPovereni,
    pockej: (ms) => new Promise((hotovo) => setTimeout(hotovo, ms)),
    ted: () => Date.now(),
    zatukej: obsluha.zatukejZarizenim,
  };
}
