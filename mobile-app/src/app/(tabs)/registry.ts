/**
 * Co v appce existuje jako členský tab — JEDINÉ místo, kde je to napsané.
 *
 * ⭐ PROČ ZVLÁŠŤ OD `_layout.tsx`. Tenhle soubor je ČISTÁ DATA: neimportuje
 * React Native, expo-router ani ikony, takže ho může přečíst i brána, která
 * nesmí zavést celý strom appky. Brána pak porovná tenhle seznam se SOUBORY
 * rout — univerzum si tedy najde, nedostane ho vypsané.
 *
 * ⛔ Bez toho by tu byl ručně vedený seznam vedle skutečnosti. Přesně tak se
 * v tomhle repu rozešel `BlockRenderer`: seznam „známých block_type" žil vedle
 * vlastních větví, sedm typů kreslilo obsah a pod ním hlásilo „neznámý typ",
 * a dvě jména RPC byla vedená jako typy bloků.
 *
 * ⚠️ `name` MUSÍ být jméno souboru routy v `(tabs)/`. Nic tady to nevynucuje
 * samo — vynucuje to brána, protože jinak by se to dalo splést a expo-router
 * by tab jen tiše nevykreslil.
 *
 * @module
 */

/** Jeden členský tab: route, popisek a testovací značka. */
export interface TabDef {
  /** Jméno souboru routy v `src/app/(tabs)/` bez přípony. */
  readonly name: string;
  /** i18n klíč popisku. */
  readonly titleKey: string;
  /** testID tlačítka v liště. */
  readonly testID: string;
}

export const TABS: readonly TabDef[] = [
  { name: "index", titleKey: "home.title", testID: "tab-home" },
  { name: "projects", titleKey: "stories.title", testID: "tab-stories" },
  { name: "monitor", titleKey: "profile.title", testID: "tab-profile" },
  { name: "wallet", titleKey: "wallet.title", testID: "tab-wallet" },
] as const;

/**
 * Které taby tenhle build ukazuje. `null` = deštníkový build = všechny.
 *
 * Čistá funkce, aby ji test volal přímo bez Expa i bez routeru — pravidlo se
 * testuje samo, render jen doloží, že prvek vznikl.
 *
 * ⛔ Profil, který netrefí ANI JEDEN existující tab, se tu NEIGNORUJE potichu:
 * vrátí prázdno a `_layout` z toho udělá appku bez lišty. Že profil jmenuje jen
 * skutečné taby, měří brána při buildu — univerzum je odvoditelné ze souborů,
 * takže na to měřidlo JE (na rozdíl od sekcí, které žijí v datech instance).
 */
export function visibleTabs(
  vsechny: readonly TabDef[],
  povolene: readonly string[] | null,
): readonly string[] {
  if (!povolene) return vsechny.map((t) => t.name);
  return vsechny.filter((t) => povolene.includes(t.name)).map((t) => t.name);
}
