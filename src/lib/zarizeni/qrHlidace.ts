/**
 * Obsah QR kódu pro nastavení tabletu s hlídačem — v prohlížeči správce.
 *
 * Tablet po továrním resetu (6× ťuknout na uvítací obrazovku) načte QR,
 * připojí se k Wi-Fi, stáhne hlídače, ověří jeho podpis a udělá z něj
 * správce zařízení. Obsah je TÝŽ, jaký vyrábí `apps/hlidac/scripts/qr.mjs`
 * (drží to test qrHlidace.test.ts proti skriptu).
 *
 * ⛔ PIN technika NEOPUSTÍ prohlížeč: do QR jde jen jeho otisk (PBKDF2-SHA256),
 * spočítaný tady přes WebCrypto. Server PIN nikdy nevidí.
 */

/** Konfigurace, jak ji vydá storage-auth `GET /zarizeni/konfigurace`. */
export interface KonfiguraceHlidace {
  applicationId: string;
  /** base64url SHA-256 podpisového certifikátu — tvar pro QR. */
  checksum: string;
  /**
   * Co hlídač rozdá appce řízenou konfigurací: adresa API a dveře.
   *
   * POZOR: jména klíčů jsou kontrakt s `Vybava.java` a s `apps/hlidac/scripts/qr.mjs`
   * (technikův skript). Producenti QR jsou TŘI a musí sypat totéž — hlídá brána
   * `vybava-hlidace-ma-jeden-kontrakt`. Ověřeno je to už v derivaci, sem
   * přichází hotové.
   */
  vybava?: { apiUrl: string; knock?: { host: string; port: number; kid: string; scope: string } };
  /** `<applicationId>/platforma.hlidac.SpravceReceiver` */
  spravce: string;
  timeZone?: string;
  locale?: string;
}

export interface WifiNastaveni {
  ssid: string;
  heslo?: string;
  zabezpeceni?: "WPA" | "WEP" | "NONE";
}

export const ITERACE_PINU = 120_000;
export const MIN_DELKA_PINU = 6;

/** PIN = jen číslice, aspoň MIN_DELKA_PINU (hlídač ho zadává numerickou klávesnicí). */
export function platnyPin(pin: string): boolean {
  return pin.length >= MIN_DELKA_PINU && /^\d+$/.test(pin);
}

function base64(bajty: Uint8Array): string {
  let s = "";
  for (const b of bajty) s += String.fromCharCode(b);
  return btoa(s);
}

/** Záznam PINu `pbkdf2_sha256$<iterace>$<sůl>$<otisk>` — tvar, který ověřuje hlídač (Pin.java). */
export async function zaznamPinu(
  pin: string,
  sul: Uint8Array = crypto.getRandomValues(new Uint8Array(16)),
  iterace: number = ITERACE_PINU,
): Promise<string> {
  if (!platnyPin(pin)) {
    throw new Error(`PIN must have at least ${MIN_DELKA_PINU} digits`);
  }
  const klic = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bity = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(sul), iterations: iterace }, klic, 256);
  return `pbkdf2_sha256$${iterace}$${base64(sul)}$${base64(new Uint8Array(bity))}`;
}

/** Obsah QR (JSON objekt). Pořadí klíčů je stejné jako ve skriptu. */
/**
 * Výbava do provisioning bundlu.
 *
 * POZOR: port jde jako ŘETĚZEC. `PersistableBundle` z QR by z čísla udělal int
 * a i když to `Vybava.java` ošetřuje, jeden tvar na drátě je jeden tvar
 * k ověření.
 *
 * Bez výbavy se vrací prázdno: instance ji mít nemusí a tablet pak jede jako
 * dosud (hodnoty zapečené v appce).
 */
export function vybavaDoBundlu(
  vybava: KonfiguraceHlidace["vybava"],
): Record<string, string> {
  if (!vybava?.apiUrl) return {};
  const p = "platforma.hlidac.";
  const out: Record<string, string> = { [`${p}API_URL`]: vybava.apiUrl };
  const k = vybava.knock;
  if (!k) return out;
  out[`${p}KNOCK_HOST`] = k.host;
  out[`${p}KNOCK_PORT`] = String(k.port);
  out[`${p}KNOCK_KID`] = k.kid;
  out[`${p}KNOCK_SCOPE`] = k.scope;
  return out;
}

/**
 * Noční okno `HH:MM-HH:MM` v rozsahu 00:00–23:59 — týž tvar, jaký přijme server
 * (services/storage-auth/src/lib/zadosti.ts) i Kiosk Admin (LocalTime).
 *
 * ⛔ NAMĚŘENO 2026-09-28 na zkušebním tabletu: okno „…-24:00" prošlo volnějším
 *    vzorem v panelu, server žádost odmítl (400) a Kiosk Admin ho při zavedení
 *    odmítl a potichu vzal výchozí 02:00-04:00. Tři vrstvy, tři pravidla.
 */
export const OKNO_VZOR = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

export function platneOkno(okno: string): boolean {
  return OKNO_VZOR.test(okno);
}

export function obsahQr(opts: {
  konfigurace: KonfiguraceHlidace;
  stazeni: string;
  pinZaznam: string;
  okno?: string;
  wifi?: WifiNastaveni | null;
}): Record<string, unknown> {
  const { konfigurace: k, stazeni, pinZaznam, okno, wifi } = opts;
  if (!/^https?:\/\//.test(stazeni)) throw new Error("download URL must be http(s)");
  // QR s oknem, které tablet odmítne, se nevydá — jinak by platilo tiše jiné.
  if (okno !== undefined && !platneOkno(okno)) throw new Error("night window must be HH:MM-HH:MM (00:00–23:59)");
  const p = "android.app.extra.";
  const obsah: Record<string, unknown> = {
    [`${p}PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME`]: k.spravce,
    [`${p}PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION`]: stazeni,
    [`${p}PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM`]: k.checksum,
    // ⛔ STAHOVAT I PŘES MOBILNÍ DATA (2026-09-29, zavádění nového tabletu). Bez tohohle
    //    Android stáhne Kiosk Admin při nastavení JEN přes Wi-Fi; tablet se SIM a bez Wi-Fi
    //    v QR skončí hned na „stahování" — a na serveru nic nechybí (soubor, otisk i adresa
    //    sedí, ověřeno). Tablety v kabinách jedou přes LTE. Android 10+ (API 29).
    [`${p}PROVISIONING_USE_MOBILE_DATA`]: true,
    [`${p}PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED`]: false,
    [`${p}PROVISIONING_ADMIN_EXTRAS_BUNDLE`]: {
      pin: pinZaznam,
      ...(okno ? { okno } : {}),
      ...vybavaDoBundlu(k.vybava),
    },
  };
  if (k.timeZone) obsah[`${p}PROVISIONING_TIME_ZONE`] = k.timeZone;
  if (k.locale) obsah[`${p}PROVISIONING_LOCALE`] = k.locale;
  if (wifi?.ssid) {
    obsah[`${p}PROVISIONING_WIFI_SSID`] = wifi.ssid;
    obsah[`${p}PROVISIONING_WIFI_SECURITY_TYPE`] = wifi.zabezpeceni ?? "WPA";
    if (wifi.heslo) obsah[`${p}PROVISIONING_WIFI_PASSWORD`] = wifi.heslo;
  }
  return obsah;
}
