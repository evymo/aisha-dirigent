/**
 * Odezva na dokončený úkon — co appka řekne rukou, ne jen očima.
 *
 * ⛔ PROČ. Řidič potvrzuje předání v rukavicích, na slunci, u běžícího motoru:
 * displej je špatně vidět a slyšet není nic. Jediný kanál, který v téhle situaci
 * spolehlivě projde, je hmat. Bez něj člověk mačká potvrzení podruhé „pro
 * jistotu" — a to je přesně ten úkon, ze kterého vznikají dvojí doklady.
 *
 * ⛔ ODEZVA NENÍ TOTÉŽ CO ÚSPĚCH. „Odesláno" a „uloženo, odejde samo" jsou dva
 * různé výsledky a dosud vypadaly i cítily se stejně — táž hláška v témže rámu.
 * Člověk pak odjede od rampy s dojmem, že práce je na serveru, a ona je
 * v telefonu. Proto má každá povaha VLASTNÍ odezvu, hmatovou i barevnou.
 *
 * ⚠️ NIKDY NESMÍ SHODIT ÚKON. Hmatová odezva je pomůcka; když nativní modul
 * chybí, na daném zařízení není motorek, nebo se import nepovede, mlčí se.
 * Proto dynamický import a spolknutá výjimka — táž doktrína jako u OCR.
 *
 * @module
 */

/** Jak dopadl úkon, o kterém se člověku říká. */
export type Povaha = "hotovo" | "fronta" | "pozor" | "chyba";

/**
 * Druh hmatové odezvy.
 *
 * `naraz` je záměrně jiná třída než `uspech`: „uloženo do fronty" NENÍ úspěch
 * odeslání a nesmí se tak cítit. Krátký náraz říká „přijal jsem to", kdežto
 * úspěchový vzor říká „hotovo" — a ten rozdíl je celý smysl téhle tabulky.
 */
export type Druh = "uspech" | "naraz" | "varovani" | "chyba";

const TABULKA: Record<Povaha, Druh> = {
  hotovo: "uspech",
  fronta: "naraz",
  pozor: "varovani",
  chyba: "chyba",
};

/** Čistá tabulka — rozhoduje o tom, co člověk ucítí. Proto má vlastní důkaz. */
export function druhOdezvy(p: Povaha): Druh {
  return TABULKA[p];
}

/**
 * Zahrát odezvu. Nikdy nevyhazuje a nikdy nezdržuje — volající ji nemusí čekat.
 *
 * ⛔ DYNAMICKÝ IMPORT. Kdyby se `expo-haptics` importoval nahoře, vtáhl by se do
 * grafu každého, kdo tenhle modul potřebuje jen kvůli tabulce — včetně testů,
 * které s nativním kódem nemají nic společného. Táž třída jako `knock.ts`:
 * první skutečný import přitáhne celý strom.
 */
export async function zahrajOdezvu(p: Povaha): Promise<void> {
  try {
    const H = await import("expo-haptics");
    switch (druhOdezvy(p)) {
      case "uspech":
        await H.notificationAsync(H.NotificationFeedbackType.Success);
        return;
      case "varovani":
        await H.notificationAsync(H.NotificationFeedbackType.Warning);
        return;
      case "chyba":
        await H.notificationAsync(H.NotificationFeedbackType.Error);
        return;
      case "naraz":
        await H.impactAsync(H.ImpactFeedbackStyle.Medium);
        return;
    }
  } catch {
    // Bez motorku, bez modulu, na simulátoru — mlčí se. Pomůcka nesmí shodit
    // předání, které už je jinak hotové.
  }
}
