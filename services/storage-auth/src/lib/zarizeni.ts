/**
 * Schopnost „zařízení“ (tablety s hlídačem) — co o ní storage-auth ví.
 *
 * VOLITELNÁ a ve výchozím stavu VYPNUTÁ. Instance ji zapne deklarací v datech
 * (`zarizeni/hlidac.json`); hák dat instance ji při nasazení core zapíše DOSLOVNĚ
 * do databáze a storage-auth ji čte odtud (`zeSuroveDeklarace`). Žádná deklarace
 * = schopnost vypnutá. Vadná = vypnutá S DŮVODEM — administrace ho ukáže, místo
 * aby tvrdila, že schopnost chybí.
 *
 * Čistý modul bez I/O.
 */
/**
 * Appka, kterou hlídač rozdává tabletům MIMO Obchod Play.
 *
 * ⭐ ZADÁNÍ MAJITELE (2026-09-22): „nešlo by aplikaci aktualizovat i mimo
 * playstore, když už tam máme hlídače?"
 *
 * ⛔ PROČ SE OTISK VEZE V DEKLARACI. Hlídač je device owner — tišší a silnější
 * instalace na tabletu neexistuje. Kdyby bral, co mu úložiště podá, byl by z něj
 * nástroj, jak na zařízení dostat cokoli. Otisk přichází z DAT INSTANCE (PR,
 * audit, vratnost), ne z odpovědi serveru.
 *
 * ⚠️ Otisk NENÍ jediná obrana a nesmí se za ni vydávat: proti PODVRŽENÍ chrání
 * Android sám — `PackageInstaller` odmítne aktualizaci podepsanou jiným klíčem
 * než ta nainstalovaná. Otisk chytá poškozený přenos a STARÝ nebo CIZÍ obsah
 * v bucketu, což je porucha, kterou by jinak nikdo nezpozoroval.
 */
export interface DistribuovanaAppka {
  /** Jméno balíčku, např. `cz.riq.ridic`. */
  balicek: string;
  versionCode: number;
  versionName: string;
  /** SHA-256 APK, hex bez dvojteček. */
  sha256: string;
  /**
   * Odkud si úložiště balíček SAMO doplní (https, typicky registr balíčků).
   * Bez něj zůstává jen ruční nahrání v administraci. Obsah nerozhoduje adresa,
   * ale `sha256` výš — cokoli jiného se do úložiště nepustí.
   */
  zdroj?: string;
}

/**
 * `zdroj` balíčku: jen https a bez přihlašovacích údajů v adrese.
 *
 * ⛔ Údaje v URL by skončily v logu i v administraci; token k registru má vlastní
 *    proměnnou a posílá se jen na nakonfigurovaný původ (`lib/registr-zdroj.ts`).
 */
export function jeZdroj(u: unknown): u is string {
  if (typeof u !== 'string' || !u) return false;
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && !x.username && !x.password;
  } catch {
    return false;
  }
}

export interface HlidacIdentita {
  applicationId: string;
  /** SHA-256 podpisového certifikátu, hex s dvojtečkami (jak ho vypíše keytool/apksigner). */
  certSha256: string;
  kioskPackage: string;
  versionName: string;
  versionCode: number;
  /**
   * SHA-256 SAMOTNÉHO APK (hex bez dvojteček) z deklarace instance — jiná věc než
   * `certSha256`, který je otiskem PODPISOVÉHO CERTIFIKÁTU. Bez něj se úložiště
   * nesrovnává: „soubor tam je" není „je tam ten správný".
   */
  apkSha256?: string;
  /** Odkud si úložiště APK Kiosk Admina samo doplní (viz `DistribuovanaAppka.zdroj`). */
  apkZdroj?: string;
  /**
   * Appky, které hlídač rozdává a aktualizuje. Prázdné/chybějící = žádné;
   * tablet pak aktualizuje jen Obchod Play, jako dosud.
   */
  appky?: DistribuovanaAppka[];
  /**
   * Co hlídač rozdá appkám řízenou konfigurací (adresa API a dveře).
   *
   * ⛔ NENÍ TO TAJEMSTVÍ: kdo hodnoty zná, ještě neumí zaťukat — klíč se odvozuje
   * z kódu, který zadá člověk. Proto smí do administrace, která z nich staví QR.
   * Ověřeno už v derivaci; sem přichází hotová.
   */
  vybava?: { apiUrl: string; knock?: { host: string; port: number; kid: string; scope: string } };
  timeZone?: string;
  locale?: string;
}

export type StavZarizeni =
  | { zapnuto: false; chyba?: string }
  | { zapnuto: true; hlidac: HlidacIdentita };

const BALICEK = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const OTISK = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** Objekt, nebo prázdný objekt — ať se do vnořených polí dá sahat bez `any`. */
function obj(x: unknown): Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
}

/**
 * Deklarace z databáze (hák dat instance): DOSLOVNÝ `zarizeni/hlidac.json`.
 *
 * Převod na normalizovaný tvar je týž jako u producenta
 * (`scripts/lib/zarizeni-deklarace.mjs` `normalizuj` — čte ho CI „Kiosk: balíčky
 * z CI“, které do deklarace zapisuje artefakty). Parita je hlídaná bránou
 * `schopnost-zarizeni` nad TÝMIŽ fixturami: co producent pustí, konzument vezme.
 *
 * ⛔ Vadná deklarace = VYPNUTO S DŮVODEM — nikdy „něco z toho".
 */
export function zeSuroveDeklarace(raw: unknown): StavZarizeni {
  if (raw === null || raw === undefined) return { zapnuto: false };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { zapnuto: false, chyba: 'deklarace zařízení není JSON objekt' };
  const r = obj(raw);
  let vybava: HlidacIdentita['vybava'];
  if (r.vybava !== undefined && r.vybava !== null) {
    const v = obj(r.vybava);
    const api = String(v.apiUrl ?? '').trim();
    if (!/^https?:\/\//.test(api)) return { zapnuto: false, chyba: 'vybava.apiUrl chybí nebo není http(s) adresa' };
    vybava = { apiUrl: api };
    if (v.knock !== undefined && v.knock !== null) {
      const k = obj(v.knock);
      const chybi = ['host', 'port', 'kid', 'scope'].filter((x) => k[x] === undefined || k[x] === null || k[x] === '');
      if (chybi.length) return { zapnuto: false, chyba: `vybava.knock je neúplná (chybí: ${chybi.join(', ')})` };
      const port = Number(k.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return { zapnuto: false, chyba: 'vybava.knock.port musí být 1–65535' };
      vybava.knock = { host: String(k.host), port, kid: String(k.kid), scope: String(k.scope) };
    }
  }
  const rApk = r.apk === undefined ? undefined : obj(r.apk);
  const apk: Record<string, unknown> | undefined = rApk
    ? {
        ...(rApk.sha256 !== undefined ? { sha256: String(rApk.sha256).toLowerCase() } : {}),
        ...(rApk.zdroj !== undefined ? { zdroj: rApk.zdroj } : {}),
      }
    : undefined;
  if (apk && 'sha256' in apk && !/^[0-9a-f]{64}$/.test(String(apk.sha256))) {
    return { zapnuto: false, chyba: 'apk.sha256 není SHA-256 (hex, 64 znaků)' };
  }
  if (apk && 'zdroj' in apk && !('sha256' in apk)) {
    return { zapnuto: false, chyba: 'apk.zdroj jen spolu s apk.sha256' };
  }
  const podpis = obj(r.signing);
  const provisioning = obj(r.provisioning);
  const appky = Array.isArray(r.appky)
    ? r.appky.map((x) => {
        const a = obj(x);
        return {
          balicek: a.balicek, versionCode: a.versionCode, versionName: a.versionName, sha256: a.sha256,
          ...(a.zdroj !== undefined ? { zdroj: a.zdroj } : {}),
          ...(a.certSha256 !== undefined ? { certSha256: a.certSha256 } : {}),
        };
      })
    : r.appky;
  return overZarizeni({
    applicationId: r.applicationId,
    kioskPackage: obj(r.kiosk).package,
    certSha256: typeof podpis.certSha256 === 'string' ? podpis.certSha256.toUpperCase() : podpis.certSha256,
    versionName: r.versionName,
    versionCode: r.versionCode,
    ...(apk ? { apk } : {}),
    ...(appky !== undefined ? { appky } : {}),
    ...(vybava ? { vybava } : {}),
    ...(typeof provisioning.timeZone === 'string' ? { timeZone: provisioning.timeZone } : {}),
    ...(typeof provisioning.locale === 'string' ? { locale: provisioning.locale } : {}),
  });
}

/** Ověření NORMALIZOVANÉ deklarace (tvar z derivace i ze `zeSuroveDeklarace`). */
export function overZarizeni(j: Record<string, unknown>): StavZarizeni {
  const applicationId = j.applicationId;
  const kioskPackage = j.kioskPackage;
  const certSha256 = typeof j.certSha256 === 'string' ? j.certSha256.toUpperCase() : j.certSha256;
  if (typeof applicationId !== 'string' || !BALICEK.test(applicationId)) {
    return { zapnuto: false, chyba: 'applicationId chybí nebo není jméno balíčku' };
  }
  if (typeof kioskPackage !== 'string' || !BALICEK.test(kioskPackage)) {
    return { zapnuto: false, chyba: 'kioskPackage chybí nebo není jméno balíčku' };
  }
  if (typeof certSha256 !== 'string' || !OTISK.test(certSha256)) {
    return { zapnuto: false, chyba: 'certSha256 chybí nebo není SHA-256 s dvojtečkami' };
  }
  if (typeof j.versionCode !== 'number' || !Number.isInteger(j.versionCode) || j.versionCode < 1) {
    return { zapnuto: false, chyba: 'versionCode musí být kladné celé číslo' };
  }
  if (typeof j.versionName !== 'string' || !j.versionName) {
    return { zapnuto: false, chyba: 'versionName chybí' };
  }
  // ⛔ VADNÁ POLOŽKA SE TICHE NEPŘESKAKUJE. Appka bez otisku nebo s nesmyslným
  //    `versionCode` je vada deklarace; kdyby se jen vynechala, tablet by nikdy
  //    nedostal aktualizaci a nikdo by se nedozvěděl proč — mlčení místo nálezu.
  const appky: DistribuovanaAppka[] = [];
  const syrove = (j as { appky?: unknown }).appky;
  if (syrove !== undefined) {
    if (!Array.isArray(syrove)) return { zapnuto: false, chyba: 'appky musí být seznam' };
    for (const a of syrove as Record<string, unknown>[]) {
      if (typeof a?.balicek !== 'string' || !BALICEK.test(a.balicek)) {
        return { zapnuto: false, chyba: 'appky[].balicek chybí nebo není jméno balíčku' };
      }
      if (typeof a.versionCode !== 'number' || !Number.isInteger(a.versionCode) || a.versionCode < 1) {
        return { zapnuto: false, chyba: `appky[${a.balicek}].versionCode musí být kladné celé číslo` };
      }
      if (typeof a.versionName !== 'string' || !a.versionName) {
        return { zapnuto: false, chyba: `appky[${a.balicek}].versionName chybí` };
      }
      if (typeof a.sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(a.sha256)) {
        return { zapnuto: false, chyba: `appky[${a.balicek}].sha256 chybí nebo není SHA-256` };
      }
      if (a.zdroj !== undefined && !jeZdroj(a.zdroj)) {
        return { zapnuto: false, chyba: `appky[${a.balicek}].zdroj musí být https adresa bez přihlašovacích údajů` };
      }
      // Otisk certifikátu, kterým MÁ být appka podepsaná — ověřuje ho CI před
      // zveřejněním. storage-auth ho nepotřebuje, ale vadný tvar je vadná
      // deklarace (táž pravidla jako producent, jinak by se parita rozešla).
      if (a.certSha256 !== undefined && (typeof a.certSha256 !== 'string' || !OTISK.test(a.certSha256.toUpperCase()))) {
        return { zapnuto: false, chyba: `appky[${a.balicek}].certSha256 není SHA-256 s dvojtečkami` };
      }
      appky.push({
        balicek: a.balicek,
        versionCode: a.versionCode,
        versionName: a.versionName,
        sha256: a.sha256.toLowerCase(),
        ...(a.zdroj !== undefined ? { zdroj: a.zdroj as string } : {}),
      });
    }
  }
  const apk = (j as { apk?: { sha256?: unknown; zdroj?: unknown } }).apk;
  if (apk?.zdroj !== undefined && !jeZdroj(apk.zdroj)) {
    return { zapnuto: false, chyba: 'apk.zdroj musí být https adresa bez přihlašovacích údajů' };
  }
  return {
    zapnuto: true,
    hlidac: {
      applicationId,
      certSha256,
      kioskPackage,
      versionName: j.versionName,
      versionCode: j.versionCode,
      // Otisk SAMOTNÉHO APK z deklarace (`apk.sha256`) — jiná věc než `certSha256`.
      // Volitelný: instance, která ho nedeklaruje, se prostě nesrovnává.
      ...(typeof apk?.sha256 === 'string' ? { apkSha256: apk.sha256 } : {}),
      ...(typeof apk?.zdroj === 'string' ? { apkZdroj: apk.zdroj } : {}),
      ...(appky.length ? { appky } : {}),
      ...(typeof (j as { vybava?: unknown }).vybava === 'object' && (j as { vybava?: unknown }).vybava !== null
        ? { vybava: (j as { vybava: HlidacIdentita['vybava'] }).vybava }
        : {}),
      ...(typeof j.timeZone === 'string' ? { timeZone: j.timeZone } : {}),
      ...(typeof j.locale === 'string' ? { locale: j.locale } : {}),
    },
  };
}

/** Otisk certifikátu → tvar, který čte ManagedProvisioning v QR (base64url bez zarovnání). */
export function checksumQr(certSha256: string): string {
  return Buffer.from(certSha256.replace(/:/g, ''), 'hex').toString('base64url');
}

/** Klíč objektu s APK hlídače v bucketu zařízení. Jeden aktuální soubor na balíček. */
export function klicApk(h: HlidacIdentita): string {
  return `hlidac/${h.applicationId}.apk`;
}

/** Klíč objektu s APK rozdávané appky. Jeden aktuální soubor na balíček. */
export function klicAppky(balicek: string): string {
  return `appky/${balicek}.apk`;
}
