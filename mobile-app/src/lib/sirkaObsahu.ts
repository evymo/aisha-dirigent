/**
 * Čitelný sloupec — proč se obsah na tabletu nesmí roztáhnout.
 *
 * ⭐ ZADÁNÍ MAJITELE (2026-08-20): *„i když je to pro telefon, asi budou mít
 * tablet, kde bude víc místa, pravděpodobně Android, ale to by mělo být
 * jedno."* — „mělo by to být jedno" je tady to podstatné: nechceme druhou
 * tabletovou appku, chceme, aby se táž appka na širší ploše chovala rozumně.
 *
 * ⛔ ŠIROKO NENÍ LÉPE. Karta roztažená na 1280 dp má nadpis vlevo, odměnu
 * u pravého okraje a mezi nimi půl metru prázdna; řádek s dokladem a produktem
 * je nekonečný a oko na jeho konci ztratí začátek. Typografická poučka je
 * 45–75 znaků na řádek — nad tím čtení měřitelně zpomaluje, a řidič u rampy
 * čte jednou a rychle.
 *
 * ⚠️ NENÍ TO BOD ZLOMU. Nekontroluje se „jsme tablet?" (a nikde se nerozhoduje
 * podle úhlopříčky), jen se řekne, jak SE MŮŽE obsah roztáhnout. Na telefonu
 * je strop nedosažitelný a nic nedělá; na tabletu a na otočeném telefonu
 * začne platit. Jeden zápis, žádná větev, žádné zařízení v podmínce.
 *
 * @module
 */
import type { ViewStyle } from "react-native";

/**
 * Nejširší rozumný sloupec textu v dp.
 *
 * 640 dp ≈ 65–70 znaků při 15–17 px, tedy horní okraj doporučeného rozsahu:
 * dole je telefon (kde se nic nemění) a nahoře nechceme sloupec, který na 10"
 * tabletu vypadá jako ztracený proužek uprostřed.
 */
export const SLOUPEC_MAX_DP = 640;

/**
 * Styl čitelného sloupce. Přidává se k obsahu, ne k obalu s pozadím — pozadí
 * má krýt celou plochu, jinak vznikne uprostřed obrazovky ostrůvek.
 */
export const sloupec: ViewStyle = {
  width: "100%",
  maxWidth: SLOUPEC_MAX_DP,
  alignSelf: "center",
};
