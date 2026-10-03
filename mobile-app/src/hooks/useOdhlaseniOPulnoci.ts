/**
 * Na tabletu v kiosku odhlásí člověka, který zůstal přihlášený přes půlnoc.
 *
 * Kontroluje při startu, při návratu appky do popředí a jednou za minutu
 * (tablet v kabině běží celý den v popředí, `AppState` by půlnoc nezachytil).
 * Rozhoduje `lib/kioskOsoba` — včetně odkladu, dokud fronta neodeslala.
 * Volá se JEN ze seznamu (porada), ne z detailu předání: podpis ani razítko
 * půlnoc nepřeruší. Telefon mimo kiosk se nechová jinak než dřív.
 */
import { useEffect } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { jeKiosk } from "@/config/knock";
import { useAuth } from "@/hooks/useAuth";
import { dnesniDen } from "@/lib/kioskRozvozy";
import { KLIC_OSOBY, rozhodniOsobu } from "@/lib/kioskOsoba";
import { safeInfo, safeWarn } from "@/lib/security/safeLogger";
import { getQueueSize } from "@/services/offline";

const KONTROLA_MS = 60_000;

export function useOdhlaseniOPulnoci(): void {
  const { isLoading, user, signOut } = useAuth();
  const uid = user?.id ?? null;

  useEffect(() => {
    // ⛔ Dokud se relace načítá, `user` je null i u přihlášeného — záznam by se
    //    smazal a po načtení zapsal s dneškem, takže by půlnoc nikdy nenastala.
    if (!jeKiosk() || isLoading) return undefined;
    let zruseno = false;

    const zkontroluj = async (): Promise<void> => {
      try {
        const cekajici = await getQueueSize().catch(() => null);
        const v = rozhodniOsobu(await AsyncStorage.getItem(KLIC_OSOBY), uid, dnesniDen(), cekajici);
        if (zruseno) return;
        if (v.akce === "zapsat") await AsyncStorage.setItem(KLIC_OSOBY, JSON.stringify(v.zaznam));
        else if (v.akce === "smazat") await AsyncStorage.removeItem(KLIC_OSOBY);
        else if (v.akce === "odlozit") safeInfo("kiosk-osoba", { akce: "odhlaseni-odlozeno", cekajici });
        else if (v.akce === "odhlasit") {
          await AsyncStorage.removeItem(KLIC_OSOBY);
          await signOut();
          safeInfo("kiosk-osoba", { akce: "odhlaseno-o-pulnoci" });
          // Kořen pošle tablet bez člověka zpět na dnešní rozvozy (`index.tsx`).
          router.replace("/");
        }
      } catch (e) {
        // Selhání úložiště nesmí tablet shodit; příští kontrola to zkusí znovu.
        safeWarn("kiosk-osoba", { chyba: e instanceof Error ? e.message : String(e) });
      }
    };

    void zkontroluj();
    const casovac = setInterval(() => void zkontroluj(), KONTROLA_MS);
    const odber = AppState.addEventListener("change", (stav) => {
      if (stav === "active") void zkontroluj();
    });
    return () => {
      zruseno = true;
      clearInterval(casovac);
      odber.remove();
    };
  }, [isLoading, uid, signOut]);
}
