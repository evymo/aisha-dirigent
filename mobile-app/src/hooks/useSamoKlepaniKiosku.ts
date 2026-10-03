/**
 * Spustí hlídku dveří, když appka běží jako TABLET v kiosku (`jeKiosk`).
 *
 * Telefon řidiče ji nemá: tam klepe člověk, nebo reaktivně appka po neúspěšném
 * odeslání (`obsluhaDveri`). Tablet u rampy nikoho nemá, proto se o dveře stará
 * sám — viz `lib/samoKlepaniKiosku.ts`.
 */
import { useEffect } from "react";
import { jeKiosk } from "@/config/knock";
import { nativeSamoKlepaniDeps } from "@/lib/obsluhaDveri-native";
import { dalsiKoloZa, koloHlidky, novaPametKiosku } from "@/lib/samoKlepaniKiosku";
import { safeInfo, safeWarn } from "@/lib/security/safeLogger";

export function useSamoKlepaniKiosku(): void {
  useEffect(() => {
    if (!jeKiosk()) return undefined;
    let zruseno = false;
    let casovac: ReturnType<typeof setTimeout> | undefined;
    const pamet = novaPametKiosku();
    const deps = nativeSamoKlepaniDeps();

    const kolo = async (): Promise<void> => {
      const v = await koloHlidky(pamet, deps);
      // Zavřeno i chyba se hlásí — tichá hlídka by vypadala jako „tablet nejede".
      if (v.vysledek === "zavreno" || v.vysledek === "chyba") safeWarn("kiosk-dvere", v);
      else if (v.vysledek === "zatukano") safeInfo("kiosk-dvere", v);
      if (!zruseno) casovac = setTimeout(() => void kolo(), dalsiKoloZa(v, pamet));
    };
    void kolo();
    return () => {
      zruseno = true;
      if (casovac) clearTimeout(casovac);
    };
  }, []);
}
