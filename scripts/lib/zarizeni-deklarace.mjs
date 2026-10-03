/**
 * zarizeni-deklarace.mjs — schopnost „zařízení“ (tablety s Kiosk Adminem), jak ji
 * instance deklaruje, a PRAVIDLO, podle kterého je deklarace platná.
 *
 * VOLITELNÁ, VE VÝCHOZÍM STAVU VYPNUTÁ. Platformní šablony klíč nemají, takže
 * merge sám nic nerozsvítí. Instance, která tablety chce, napíše do profilu:
 *
 *     "zarizeni": { "hlidac": "zarizeni/hlidac.json" }
 *
 * — cestu k identitě hlídače UVNITŘ svých dat. Soubor jde DOSLOVNĚ hákem dat
 * instance do databáze a storage-auth ho čte odtud (`zeSuroveDeklarace` — parita
 * s `normalizuj` níž hlídaná bránou `schopnost-zarizeni`). Do 2026-09 ho místo
 * toho derivace kódovala do env `ZARIZENI_HLIDAC`; tahle cesta zanikla spolu
 * s jejím čtenářem.
 *
 * Kdo pravidlo používá: CI „Kiosk: balíčky z CI“ (scripts/ci/kiosk-balicky.mjs)
 * — plán, úprava artefaktů a `over` pro CI dat instance. Producent musí být
 * aspoň tak přísný jako konzument.
 *
 * Čistý modul bez I/O: soubor dodá volající.
 *
 * ⛔ Vadná deklarace = CHYBA nahlas (výjimka), ne tichý přeskok: jinak by vznikla
 * instance, kde tablety „nejsou“, a nikde by nestálo proč.
 */

const BALICEK = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const OTISK = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
/** SHA-256 souboru: hex bez dvojteček (jak ho vypíše `sha256sum`). */
const OTISK_SOUBORU = /^[0-9a-fA-F]{64}$/;

/**
 * `profile.zarizeni` → cesta k identitě hlídače uvnitř dat instance, nebo null
 * (instance tablety nechce). Čte ji CI, které balíčky staví
 * (scripts/ci/kiosk-balicky.mjs) — jedno pravidlo, jeden domov.
 *
 * @param {unknown} deklarace
 * @returns {string | null}
 */
export function cestaIdentity(deklarace) {
  if (deklarace === undefined || deklarace === null) return null;
  if (typeof deklarace !== "object" || Array.isArray(deklarace)) {
    throw new Error(`profil instance: "zarizeni" musí být objekt { "hlidac": "<cesta>" }`);
  }
  const nezname = Object.keys(deklarace).filter((k) => k !== "hlidac" && !k.startsWith("_"));
  if (nezname.length > 0) {
    throw new Error(`profil instance: "zarizeni" zná jen klíč "hlidac" — navíc: ${nezname.join(", ")}`);
  }
  const cesta = deklarace.hlidac;
  if (typeof cesta !== "string" || !cesta.trim()) {
    throw new Error(`profil instance: "zarizeni.hlidac" musí být cesta k identitě hlídače v datech instance`);
  }
  // Cesta patří DOVNITŘ dat instance: absolutní ani `..` by derivaci pustily
  // číst cokoli na stroji, kde cold start běží.
  if (cesta.startsWith("/") || cesta.split(/[\\/]/).includes("..")) {
    throw new Error(`profil instance: "zarizeni.hlidac" musí být relativní cesta uvnitř dat instance, ne "${cesta}"`);
  }
  return cesta;
}

/**
 * `zdroj` balíčku (odkud si úložiště APK samo doplní): jen https a bez
 * přihlašovacích údajů v adrese. Stejné pravidlo jako `jeZdroj` ve storage-auth —
 * producent nesmí pustit, co konzument odmítne (vypnul by celou schopnost).
 */
function jeZdroj(u) {
  if (typeof u !== "string" || !u) return false;
  try {
    const x = new URL(u);
    return x.protocol === "https:" && !x.username && !x.password;
  } catch {
    return false;
  }
}

/** Z identity hlídače (tvar apps/hlidac/hlidac.example.json) vezme jen to, co potřebuje storage-auth a QR. */
export function normalizuj(j, cesta = "hlidac.json") {
  const vadne = (co) => new Error(`${cesta}: ${co}`);
  if (!BALICEK.test(String(j?.applicationId ?? ""))) throw vadne("applicationId chybí nebo není jméno balíčku");
  const kiosk = j?.kiosk?.package;
  if (!BALICEK.test(String(kiosk ?? ""))) throw vadne("kiosk.package chybí nebo není jméno balíčku");
  const otisk = String(j?.signing?.certSha256 ?? "").toUpperCase();
  if (!OTISK.test(otisk)) throw vadne("signing.certSha256 chybí nebo není SHA-256 s dvojtečkami — bez něj QR nevznikne");
  if (!Number.isInteger(j?.versionCode) || j.versionCode < 1) throw vadne("versionCode musí být kladné celé číslo");
  if (typeof j?.versionName !== "string" || !j.versionName) throw vadne("versionName chybí");
  // ⛔ PRODUCENT MUSÍ BÝT ASPOŇ TAK ŠIROKÝ JAKO ROZHODOVAČ. `apk.sha256` a
  //    `appky[]` čte storage-auth, aby srovnal úložiště s deklarací. Kdyby je
  //    tahle normalizace zahodila (a do 2026-09-22 zahazovala), konzument by
  //    dostal `undefined`, srovnání by hlásilo „neúplná deklarace" a MLČKY by
  //    nikdy nic nedoplnilo — tablet by čekal na aktualizaci, která nepřijde.
  const apkOtisk = j?.apk?.sha256;
  if (apkOtisk !== undefined && !OTISK_SOUBORU.test(String(apkOtisk))) {
    throw vadne("apk.sha256 není SHA-256 (hex, 64 znaků, bez dvojteček)");
  }
  // `zdroj` (2026-09-24): odkud si úložiště balíček samo doplní. Bez otisku by
  //    nešlo ověřit, co se stáhlo — proto jen spolu s ním.
  const apkZdroj = j?.apk?.zdroj;
  if (apkZdroj !== undefined && (!jeZdroj(apkZdroj) || apkOtisk === undefined)) {
    throw vadne("apk.zdroj musí být https adresa bez přihlašovacích údajů a jen spolu s apk.sha256");
  }
  // ⛔ VÝBAVA SE OVĚŘUJE TADY A JEN TADY. Producentů QR je VÍC (skript pro
  //    technika i administrace) a kdyby si každý ověřoval po svém, rozešly by se
  //    — jeden by tablet vybavil a druhý ne, podle toho, kudy technik šel.
  let vybava;
  if (j?.vybava !== undefined && j.vybava !== null) {
    const v = j.vybava;
    const api = String(v.apiUrl ?? "").trim();
    if (!/^https?:\/\//.test(api)) throw vadne("vybava.apiUrl chybí nebo není http(s) adresa");
    vybava = { apiUrl: api };
    if (v.knock !== undefined && v.knock !== null) {
      const k = v.knock;
      const chybi = ["host", "port", "kid", "scope"].filter((x) => k[x] === undefined || k[x] === null || k[x] === "");
      // ⛔ Částečná sada dveří je VADA, ne „bez dveří": appka by nabídku klepání
      //    skryla a nikdo by se nedozvěděl proč.
      if (chybi.length) throw vadne(`vybava.knock je neúplná (chybí: ${chybi.join(", ")}) — buď všechny čtyři, nebo žádná`);
      const port = Number(k.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw vadne("vybava.knock.port musí být 1–65535");
      vybava.knock = { host: String(k.host), port, kid: String(k.kid), scope: String(k.scope) };
    }
  }
  const appky = [];
  if (j?.appky !== undefined) {
    if (!Array.isArray(j.appky)) throw vadne("appky musí být seznam");
    for (const a of j.appky) {
      if (!BALICEK.test(String(a?.balicek ?? ""))) throw vadne("appky[].balicek chybí nebo není jméno balíčku");
      if (!Number.isInteger(a?.versionCode) || a.versionCode < 1) {
        throw vadne(`appky[${a.balicek}].versionCode musí být kladné celé číslo`);
      }
      if (typeof a?.versionName !== "string" || !a.versionName) throw vadne(`appky[${a.balicek}].versionName chybí`);
      if (!OTISK_SOUBORU.test(String(a?.sha256 ?? ""))) {
        throw vadne(`appky[${a.balicek}].sha256 chybí nebo není SHA-256 (hex, 64 znaků)`);
      }
      if (a.zdroj !== undefined && !jeZdroj(a.zdroj)) {
        throw vadne(`appky[${a.balicek}].zdroj musí být https adresa bez přihlašovacích údajů`);
      }
      // Otisk certifikátu, kterým MÁ být appka podepsaná (ověřuje CI před
      // zveřejněním; deklaruje ho člověk, ne CI). Do výstupu nejde.
      if (a.certSha256 !== undefined && !OTISK.test(String(a.certSha256).toUpperCase())) {
        throw vadne(`appky[${a.balicek}].certSha256 není SHA-256 s dvojtečkami`);
      }
      appky.push({
        balicek: a.balicek,
        versionCode: a.versionCode,
        versionName: a.versionName,
        sha256: String(a.sha256).toLowerCase(),
        ...(a.zdroj !== undefined ? { zdroj: a.zdroj } : {}),
      });
    }
  }
  return {
    applicationId: j.applicationId,
    kioskPackage: kiosk,
    certSha256: otisk,
    versionName: j.versionName,
    versionCode: j.versionCode,
    ...(apkOtisk !== undefined
      ? { apk: { sha256: String(apkOtisk).toLowerCase(), ...(apkZdroj !== undefined ? { zdroj: apkZdroj } : {}) } }
      : {}),
    ...(appky.length ? { appky } : {}),
    ...(vybava ? { vybava } : {}),
    ...(typeof j?.provisioning?.timeZone === "string" ? { timeZone: j.provisioning.timeZone } : {}),
    ...(typeof j?.provisioning?.locale === "string" ? { locale: j.provisioning.locale } : {}),
  };
}
