import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * Řízená konfigurace od správce zařízení (u nás hlídač).
 *
 * ⛔ MODUL JE VOLITELNÝ. Na iOSu a ve vývojovém klientu neexistuje; chybějící
 * modul znamená „žádná řízená konfigurace", ne pád. Appka pak spadne zpět na
 * hodnoty ze sestavení — tedy na dnešní chování.
 */
const nativni = requireOptionalNativeModule<{ precti(): Record<string, string> }>("RizenaKonfigurace");

export function rizenaKonfigurace(): Record<string, string> {
  try {
    return nativni?.precti() ?? {};
  } catch {
    // Správce může konfiguraci kdykoli vzít; to není porucha appky.
    return {};
  }
}
