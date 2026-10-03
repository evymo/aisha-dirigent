/**
 * ČERSTVÁ INSTALACE — pověření nesmí přežít smazání aplikace.
 *
 * ⛔ NAMĚŘENO 2026-09-01 (hlášení majitele): po odinstalaci a nové instalaci
 *    appka skočila rovnou dovnitř a ptala se na předvolby, místo aby nechala
 *    zaťukat. Řetěz: `useAuth` odvozuje přihlášenost z pouhé PŘÍTOMNOSTI relace
 *    (`isAuthenticated: !!session`), `expo-secure-store` ukládá do iOS Keychainu
 *    a ten smazání aplikace PŘEŽÍVÁ — je to zdokumentované chování systému, ne
 *    chyba. `index.tsx` pak vidí „přihlášen", pošle na `naturel-calibration`,
 *    a tichá cesta ven (odkaz na ťukání) zůstane na přihlašovací obrazovce,
 *    kam se člověk už nedostane. Přesně ta „cihla", které mělo zabránit zadání
 *    z 2026-08-20.
 *
 * ⭐ ZNAČKA BYDLÍ V `AsyncStorage`, A TO JE CELÝ TRIK. Ten se při odinstalaci
 *    MAŽE, kdežto Keychain ne. Rozdíl mezi „mám relaci" a „mám relaci z minulé
 *    instalace" se tedy nedá poznat z relace samotné — pozná se z toho, co
 *    odinstalaci nepřežilo.
 *
 * ⛔ NEMAŽE SE NIC JINÉHO. Značka říká jen „tahle instalace už běžela";
 *    o platnosti relace nevypovídá a nenahrazuje kontrolu expirace.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { safeWarn } from "@/lib/security/safeLogger";

const KLIC = "instalace.znacka.v1";

/**
 * Běží tahle instalace poprvé?
 *
 * ⛔ FAIL-CLOSED PŘI CHYBĚ ÚLOŽIŠTĚ: když se `AsyncStorage` nedá přečíst,
 *    vrací `false` — tedy „neuklízej". Zahodit člověku přihlášení kvůli
 *    nečitelnému úložišti by bylo horší než ponechat relaci, kterou stejně
 *    prověří první požadavek na API.
 */
export async function jePrvniBehPoInstalaci(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KLIC)) === null;
  } catch (error) {
    safeWarn("instalace.znacka.cteni", error);
    return false;
  }
}

/** Zapíše značku, aby příští start už první nebyl. */
export async function oznacInstalaci(): Promise<void> {
  try {
    await AsyncStorage.setItem(KLIC, new Date().toISOString());
  } catch (error) {
    // Nezapsaná značka znamená, že se příště uklidí ještě jednou — to je
    // nepříjemné, ne nebezpečné. Pád startu appky by nebezpečný byl.
    safeWarn("instalace.znacka.zapis", error);
  }
}
