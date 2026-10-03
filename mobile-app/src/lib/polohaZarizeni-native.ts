/**
 * Nativní adaptér polohy — JEDINÉ místo v appce, které linkuje `expo-location`.
 *
 * Čistá logika (`polohaZarizeni.ts`) o nativním modulu neví, takže tentýž kód
 * běží v testu i na tabletu. Tenhle soubor se do jestu netahá.
 */
import * as Location from "expo-location";
import type { NamerenaPoloha, PolohaDeps } from "./polohaZarizeni";

const zMereni = (m: Location.LocationObject | null): NamerenaPoloha | null =>
  m
    ? { lat: m.coords.latitude, lon: m.coords.longitude, accuracy: m.coords.accuracy ?? null, timestamp: m.timestamp }
    : null;

export function nativePolohaDeps(): PolohaDeps {
  return {
    opravneni: async () => {
      // Na spravovaném tabletu je oprávnění udělené hlídačem předem, takže se
      // nikdo na nic neptá. Na telefonu se zeptá jednou, v okamžiku potvrzení.
      const stav = await Location.getForegroundPermissionsAsync();
      if (stav.granted) return "granted";
      if (!stav.canAskAgain) return "denied";
      const odpoved = await Location.requestForegroundPermissionsAsync();
      return odpoved.granted ? "granted" : "denied";
    },
    sluzbyZapnute: () => Location.hasServicesEnabledAsync(),
    aktualni: async (timeoutMs) => {
      let casovac: ReturnType<typeof setTimeout> | undefined;
      const limit = new Promise<null>((resolve) => {
        casovac = setTimeout(() => resolve(null), timeoutMs);
      });
      try {
        const mereni = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          limit,
        ]);
        return zMereni(mereni);
      } finally {
        if (casovac) clearTimeout(casovac);
      }
    },
    posledniZnama: async (maxStariMs) => zMereni(await Location.getLastKnownPositionAsync({ maxAge: maxStariMs })),
  };
}
