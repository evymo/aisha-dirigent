/**
 * Post-login surface routing (W1 of the extranet-in-mobile plan).
 *
 * The user's product direction: a user who is NOT admin/staff and does not need
 * the existing member surfaces should land on the extranet as their default.
 * Admin/staff always see the member tabs first (they run the platform). Which
 * default a build prefers is BRAND DATA, not code — `version.json`
 * `brand.defaultSurface` → `app.config` `extra.AISHA_DEFAULT_SURFACE`. No new
 * backend, no new role: the decision reads the existing KC realm-role claim the
 * app already consumes.
 *
 * ⭐ CO SE TU ZMĚNILO (2026-08-19) A PROČ. Do dneška tu stála uzavřená unie
 * `"tabs" | "porada"` a funkce doslova `extra === "porada" ? "porada" : "tabs"`.
 * Komentář nad ní přitom sliboval, že si instance default „překlopí ve svém
 * overlayi" — jenže overlay je DATA a tahle unie zná dvě hodnoty, takže žádná
 * třetí sekce se sem nedostala bez změny kódu platformy.
 *
 * ⛔ A přesně o to jde: sekce je OTEVŘENÝ TEXT v databázi
 * (`surface_layouts.surface`), instance jich má dnes sedm a `porada` je jen
 * jedna z nich. Klient, který jich zná dvě, tedy nevyjádří ani appku řidiče
 * (`vyvoz`), ani appku odečítače (`meridla`) — a obojí je přitom TÝŽ KÓD nad
 * jinými daty. Rezervované je od teď jediné slovo: `tabs`. Cokoli jiného je
 * SLUG SEKCE a jde do extranetu jako parametr.
 *
 * ⚠️ Klient tím nic neotevírá. Co uživatel na sekci uvidí, rozhoduje server
 * (`list_surface_sections` + `workflow_step_visible_to`); tohle je pouze to,
 * NA CO SE APPKA ZEPTÁ JAKO PRVNÍ. Sekce, kterou uživatel nemá, vyjde prázdná —
 * proto obrazovka drží `pickSurface` a nespoléhá na tenhle řetězec slepě.
 */
import Constants from "expo-constants";

/**
 * Jediná rezervovaná hodnota `brand.defaultSurface`. Všechno ostatní je slug
 * sekce — proto je to konstanta a ne další větev: kdo čte kód, má vidět, že
 * výčet má právě jeden prvek a zbytek je otevřený.
 */
export const TABS = "tabs";

/** `tabs` (členské taby), nebo slug extranetové SEKCE, na kterou build přistává. */
export type DefaultSurface = typeof TABS | (string & {});

/** admin/staff run the platform → member tabs first, never a field surface. */
export function isAdminOrStaff(roles: readonly string[] | undefined): boolean {
  return (roles ?? []).some((r) => r === "admin" || r === "staff");
}

/**
 * Co si build přeje jako první obrazovku (brand data; bez hodnoty = taby).
 *
 * Prázdný řetězec je TÁŽ VĚC jako chybějící hodnota, ne třetí stav: `""` by se
 * jinak poslal do routeru jako slug sekce a appka by se ptala na sekci beze jména.
 */
export function brandDefaultSurface(): DefaultSurface {
  const extra = Constants.expoConfig?.extra?.AISHA_DEFAULT_SURFACE;
  if (typeof extra !== "string") return TABS;
  const slug = extra.trim();
  return slug === "" ? TABS : slug;
}

/**
 * Kam přihlášený uživatel přistane.
 *
 * Extranet jen tehdy, když se build přihlásil o sekci A uživatel není
 * admin/staff; všichni ostatní dostanou členské taby. Čistá funkce, aby router
 * a jeho test sdílely jeden zdroj pravdy.
 *
 * ⚠️ Cesta zůstává `/porada` i pro jinou sekci: ta obrazovka je od začátku
 * GENERICKÁ (kreslí layout kterékoli sekce) a jméno souboru je historické.
 * Přejmenování je vlastní úklid — deep linky na `/porada` dnes vedou i z
 * notifikací, takže by to nebyla kosmetika.
 */
export type LandingRoute = "/(tabs)" | { pathname: "/porada"; params: { surface: string } };

export function resolveLandingRoute(roles: readonly string[] | undefined): LandingRoute {
  const surface = brandDefaultSurface();
  if (surface !== TABS && !isAdminOrStaff(roles)) {
    return { pathname: "/porada", params: { surface } };
  }
  return "/(tabs)";
}
