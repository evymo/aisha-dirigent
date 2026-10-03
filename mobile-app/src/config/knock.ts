/**
 * Kam se ťuká — instanční hodnoty, ne konstanty v kódu.
 *
 * ⛔ ŽÁDNÉ VÝCHOZÍ HODNOTY. Dveře mlčí i při úspěchu, takže zaťukání na
 * uhodnutou adresu, port nebo `kid` vypadá úplně stejně jako zaťukání správné:
 * nic se nestane. Dosazená „rozumná" hodnota by z toho udělala poruchu, kterou
 * nelze odlišit od zavřených dveří — a člověk by donekonečna psal správný kód
 * do špatných dveří. Chybějící údaj proto znamená STOP a pojmenování, co chybí.
 *
 * `kid` je součástí odvození klíče (`deriveFromPassword(kód, kid)`), ne jen
 * adresou v rosteru — uhodnutý `kid` tedy vyrobí i jiné klíče a server odmítne
 * na `unknown-kid`. Další důvod, proč se nesmí dosazovat.
 */
import Constants from "expo-constants";
import type { KnockTarget } from "@/lib/knock";
import { rizenaKonfigurace } from "../../modules/rizena-konfigurace";

/**
 * Klíče, kterými hlídač předává výbavu řízenou konfigurací.
 *
 * ⛔ JSOU KONTRAKT s `Vybava.java` a `qr.mjs`. Přejmenování na kterékoli straně
 * nic neshodí — appka jen tiše nedostane adresu a pozná se to až u tabletu.
 */
const SPRAVCE = {
  EXPO_PUBLIC_KNOCK_HOST: "platforma.hlidac.KNOCK_HOST",
  EXPO_PUBLIC_KNOCK_PORT: "platforma.hlidac.KNOCK_PORT",
  EXPO_PUBLIC_KNOCK_KID: "platforma.hlidac.KNOCK_KID",
  EXPO_PUBLIC_KNOCK_SCOPE: "platforma.hlidac.KNOCK_SCOPE",
} as const;

/** Co chybí, aby šlo zaťukat. Prázdné pole = lze. */
export interface KnockTargetResolution {
  target: KnockTarget | null;
  /** Jména nedeklarovaných hodnot — do hlášky pro člověka, ne do logu. */
  chybi: string[];
}

/**
 * Hodnota od SPRÁVCE ZAŘÍZENÍ, jinak ze sestavení.
 *
 * ⭐ ZADÁNÍ MAJITELE (2026-09-22): „tím pádem by nám ani nemohl nikdo klepat na
 * dveře, protože by jen s appkou ve store nevěděl jak." Stejné APK z Obchodu
 * Play dveře nezná; výbavu dostane až na zavedeném tabletu od hlídače.
 *
 * ⛔ SPRÁVCE VYHRÁVÁ NAD SESTAVENÍM, ne naopak. Opačné pořadí by znamenalo, že
 * zapečená hodnota přebije tu, kterou správce právě změnil — a změna adresy by
 * si pak vynutila nový build, tedy přesně ten stav, který tohle ruší.
 *
 * ⛔ ŽÁDNÉ MÍCHÁNÍ PŮLEK. Buď má správce ÚPLNOU sadu dveří, nebo se na jeho
 * hodnoty nesahá vůbec: host od správce s `kid` ze sestavení by vyrobil klíč,
 * který u dveří skončí na `unknown-kid` — tedy mlčením.
 */
function retezec(key: string): string | null {
  const odSpravce = SPRAVCE[key as keyof typeof SPRAVCE];
  if (odSpravce && spravceMaDvere()) {
    const v = rizenaKonfigurace()[odSpravce];
    if (typeof v === "string" && v.length > 0) return v;
  }
  const v = (Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Má správce zařízení ÚPLNOU sadu dveří? Půlka se nebere. */
function spravceMaDvere(): boolean {
  const k = rizenaKonfigurace();
  return Object.values(SPRAVCE).every((klic) => typeof k[klic] === "string" && k[klic].length > 0);
}

/**
 * Adresa platformy od správce zařízení, nebo null.
 *
 * Appka z Obchodu Play ji nezná; na zavedeném tabletu ji nese hlídač.
 */
/**
 * Běží appka jako TABLET v kiosku? Poznává se podle toho, že dveře dodal správce
 * zařízení (Kiosk Admin, řízená konfigurace) — ne podle přepínače v sestavení:
 * tatáž APK je na telefonu řidiče i na tabletu.
 */
export function jeKiosk(): boolean {
  return spravceMaDvere();
}

export function apiUrlOdSpravce(): string | null {
  const v = rizenaKonfigurace()["platforma.hlidac.API_URL"];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Pod jakým `kid` se klepe KÓDEM: ze sestavení, pokud ho nese; jinak od správce.
 *
 * ⭐ Kódem klepe vždy ČLOVĚK (technik při zavádění tabletu, obrazovka Zaklepat)
 * a `kid` je sůl odvození jeho klíče. Patří k člověku v rosteru instance, ne
 * k adrese dveří. Dedikované sestavení ho nese z dat instance (`brand.knock.kid`).
 *
 * ⛔ PROČ TADY SESTAVENÍ VYHRÁVÁ NAD SPRÁVCEM (jediná výjimka z `retezec`):
 * výbavu dostal Kiosk Admin JEDNOU z QR a obnovit ji nejde. Nový QR ani
 * aktualizaci Kiosk Adminu Google Play Protect od 19. 9. 2026 blokuje
 * (allowlist DPC při zavádění). Tablet zavedený dřív tak nese zastaralý `kid`
 * a kód technika na něm nikdy neprojde (NAMĚŘENO 29. 9. v svc-knock:
 * `drop reason=bad-hmac` pod kid z výbavy, týž kód pod kid z dat instance
 * dveře otevřel). Appku rozdává Kiosk Admin, takže opravená hodnota dojde
 * jen touhle cestou.
 *
 * Míchání půlek (viz `retezec`) tu nehrozí: `kid` je identita v rosteru
 * INSTANCE, ne vlastnost adresy, a dedikované sestavení je k instanci
 * připnuté. U sestavení z CI brána `scripts/ci/verejna-tvar.mjs` hlídá shodu
 * s výbavou, takže rozdíl vznikne jen zastaralou výbavou, tedy právě tam, kde
 * má vyhrát sestavení. Appka z Obchodu Play `kid` nenese a bere ho od správce.
 */
function kidKodem(): string | null {
  const zeSestaveni = (Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.EXPO_PUBLIC_KNOCK_KID;
  if (typeof zeSestaveni === "string" && zeSestaveni.length > 0) return zeSestaveni;
  return retezec("EXPO_PUBLIC_KNOCK_KID");
}

/**
 * Sestaví cíl z konfigurace sestavení.
 *
 * Port se čte jako řetězec a převádí zde: `extra` nese hodnoty z prostředí,
 * kde je všechno text. Nečíselný port je CHYBĚJÍCÍ údaj, ne důvod dosadit 18181 —
 * viz hlavička.
 */
export function resolveKnockTarget(): KnockTargetResolution {
  const host = retezec("EXPO_PUBLIC_KNOCK_HOST");
  const portRaw = retezec("EXPO_PUBLIC_KNOCK_PORT");
  const kid = kidKodem();
  const scope = retezec("EXPO_PUBLIC_KNOCK_SCOPE");

  const port = portRaw !== null ? Number(portRaw) : NaN;
  const portOk = Number.isInteger(port) && port > 0 && port < 65536;

  const chybi: string[] = [];
  if (!host) chybi.push("EXPO_PUBLIC_KNOCK_HOST");
  if (!portOk) chybi.push("EXPO_PUBLIC_KNOCK_PORT");
  if (!kid) chybi.push("EXPO_PUBLIC_KNOCK_KID");
  // `scope` se NEODVOZUJE: u ověření by chybějící seznam znamenal „jakýkoli
  // scope", a nesouhlasný scope vypadá zvenčí stejně jako špatné heslo
  // (`scope-denied` se ven nehlásí). Musí se shodovat s rosterem.
  if (!scope) chybi.push("EXPO_PUBLIC_KNOCK_SCOPE");

  if (chybi.length > 0) return { chybi, target: null };
  return { chybi: [], target: { host: host!, kid: kid!, port, scope: scope! } };
}

/**
 * Máme ČÍM zaťukat? Rozhoduje, jestli se nabídka vůbec zobrazí.
 *
 * ⛔ NEŘÍKÁ, JESTLI NĚKDE DVEŘE JSOU (majitel, 2026-08-20). To appka zjistit
 * NEMŮŽE a nikdy nebude: dveře mlčí i při úspěchu, takže se nedá ZEPTAT, jen
 * ZKUSIT. Tohle je tvrzení o VLASTNÍ VÝBAVĚ — jestli tenhle build ví, kam,
 * na který port, pod jakým `kid` a s jakým scope ťukat.
 *
 * ⚠️ Dřív se funkce jmenovala `maDvere()` a hláška zněla „Tahle aplikace dveře
 * nemá". Obojí tvrdilo něco o SVĚTĚ podle toho, co víme o SOBĚ — a to je táž
 * záměna, kvůli které se pak hlásí „server je rozbitý", když jen chybí údaj.
 */
export function lzeZaklepat(): boolean {
  return resolveKnockTarget().target !== null;
}
