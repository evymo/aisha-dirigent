/**
 * Pověření ZAŘÍZENÍ — klíč, kterým telefon ťuká sám za sebe (VER 2).
 *
 * ⛔ PROČ VER 2 A NE SDÍLENÉ TAJEMSTVÍ. `knock-roster.mjs --device` dnes vyrábí
 * náhodné symetrické klíče, které zná telefon I vrátný. Takové „pověření
 * zařízení" je jen kód, který si nikdo nepamatuje — kdo ho jednou uvidí, ťuká
 * navždy jako to zařízení. `verify.ts` to říká natvrdo:
 *
 *     zařízení NESMÍ mít hmacKeyHex — sdílené tajemství ruší smysl VER 2
 *
 * Tady tedy vzniká ASYMETRICKÝ pár: soukromá část NEOPUSTÍ telefon, ven jde
 * jen veřejný otisk. Backend nikdy nezná nic, čím by mohl ťukat za nás.
 *
 * ⭐ ČISTÉ JÁDRO. Tenhle soubor neimportuje nic nativního — týž vzor jako
 * `knock.ts` × `knock-native.ts` a `trezor.ts`. Krypto i úložiště přicházejí
 * parametrem, takže tentýž kód běží v jestu i na telefonu a testy nelinkují C++.
 *
 * ⭐ PŘEŽIJE AKTUALIZACI, NE ODINSTALACI. Klíč leží v secure-store, který
 * aktualizaci appky přečká. Odinstalace ani „vymazat data" ho ale smažou — a to
 * je správně: po nich je to z pohledu vrátného JINÉ zařízení a člověk musí
 * zaťukat ručně. Táž cesta platí po zneplatnění na backendu; žádná zvláštní
 * větev pro to není potřeba.
 */
import { PUBKEY_BYTES, kidZKlice } from "@aisha/knock-protocol";

/** Kde pověření bydlí. Jméno je součást kontraktu — přejmenování = ztráta klíče. */
export const KLIC_POVERENI = "aisha.knock.device.v2";

export interface UlozisteKlicu {
  /** Vrací `null`, když klíč není — NE prázdný řetězec: to jsou dva různé stavy. */
  precti: (klic: string) => Promise<string | null>;
  zapis: (klic: string, hodnota: string) => Promise<void>;
  smaz: (klic: string) => Promise<void>;
}

export interface KryptoZarizeni {
  /** Vyrobí pár P-256. `privateKeyPem` zůstane v telefonu, `publicKeyHex` jde ven. */
  novyPar: () => { privateKeyPem: string; publicKeyHex: string };
  /** ECDSA-SHA256 podpis zprávy soukromým klíčem. */
  podepis: (privateKeyPem: string, zprava: Uint8Array) => Uint8Array;
}

export interface PovereniZarizeni {
  /** Identifikátor v rosteru vrátného. Odvozený z otisku, ne náhodný. */
  kid: string;
  privateKeyPem: string;
  publicKeyHex: string;
  /**
   * S jakým `scope` tohle zařízení ťuká.
   *
   * ⛔ PATŘÍ K PRŮKAZU, NE K PROFILU APPKY (naměřeno 2026-09-09). Ověřovatel
   * porovnává `frame.scope` se `scopes` V ROSTERU a při neshodě vrací
   * `scope-denied` — což se ven NEHLÁSÍ, protože dveře mlčí vždycky. Kdyby se
   * scope bral z konfigurace sestavení, mohl by se po aktualizaci appky změnit
   * pod schváleným zařízením a to by přestalo fungovat ZPŮSOBEM K NEROZEZNÁNÍ
   * od zavřených dveří. Uložením se zafixuje přesně ta hodnota, kterou správce
   * viděl v otisku a podle níž zařízení zapsal.
   */
  scope: string;
}

/**
 * Otisk zařízení. Odvození bydlí ve SDÍLENÉM balíčku (`@aisha/knock-protocol`),
 * protože je potřebují obě strany: telefon si tak pojmenuje sám sebe a roster
 * musí pod týmž jménem najít veřejný klíč. Dvě odvození = `unknown-kid` při
 * první úpravě, tedy mlčení k nerozeznání od zavřených dveří.
 */
export { kidZKlice };

/**
 * ⛔ TVAR VEŘEJNÉHO KLÍČE SE MĚŘÍ TADY, NE AŽ U VRÁTNÉHO. Klíč se registruje ke
 * schválení; kdyby vyšel ven ve špatném tvaru, zařízení by se schválilo a ťukání
 * by pak selhávalo jako `bad-sig` — tedy hlášením, které o příčině neřekne nic
 * a je od téhle chvíle vzdálené dvě strany a jedno lidské schválení.
 *
 * `PUBKEY_BYTES` je TÝŽ kontrakt, kterým měří `verify.ts`; import ze společného
 * balíčku je schválně, aby to nebyla druhá pravda o téže délce.
 */
export function zkontrolujVerejnyKlic(publicKeyHex: string): void {
  if (publicKeyHex.length !== PUBKEY_BYTES * 2)
    throw new Error(
      `veřejný klíč má ${publicKeyHex.length / 2} B, čeká se ${PUBKEY_BYTES} (SEC1 0x04||X||Y)`,
    );
  if (!publicKeyHex.startsWith("04"))
    throw new Error("veřejný klíč není nekomprimovaný SEC1 bod (chybí předpona 0x04)");
}

/**
 * Přečte uložené pověření a ověří, že je celé. Vrací `null`, když žádné není.
 *
 * ⛔ NEVYRÁBÍ. Tohle je cesta pro AUTOMATIKU, a ta nesmí sama vyrobit průkaz,
 * kterým se pak sama pustí dovnitř: kdyby čtení zakládalo, měl by pověření
 * KAŽDÝ telefon a podmínka „má průkaz" by neznamenala nic. Pár vzniká výhradně
 * ve `povereniZarizeni()`, tedy na výslovný lidský úkon (zavedení zařízení).
 *
 * ⛔ Nečitelné uložené pověření SELŽE, nevrátí `null`. „Není" a „je rozbité"
 * jsou dva různé stavy; splynout smí až v rozhodnutí volajícího, ne v měřidle.
 */
export async function nactiPovereni(uloziste: UlozisteKlicu): Promise<PovereniZarizeni | null> {
  const ulozene = await uloziste.precti(KLIC_POVERENI);
  if (ulozene === null) return null;
  return rozeberUlozene(ulozene);
}

/** Společný rozbor uloženého záznamu — jedno místo, kde se čte formát na disku. */
function rozeberUlozene(ulozene: string): PovereniZarizeni {
  let p: Partial<PovereniZarizeni>;
  try {
    p = JSON.parse(ulozene) as Partial<PovereniZarizeni>;
  } catch {
    throw new Error(
      `${KLIC_POVERENI}: uložené pověření nejde přečíst. NEVYRÁBÍM nové — ` +
        `tichá výměna klíče vypadá stejně jako útok. Smaž ho výslovně a zaťukej ručně.`,
    );
  }
  if (!p.privateKeyPem || !p.publicKeyHex) {
    throw new Error(`${KLIC_POVERENI}: uložené pověření je neúplné (chybí klíč). NEVYRÁBÍM nové.`);
  }
  // Průkaz bez `scope` je z doby, kdy se bral z konfigurace sestavení. Doplnit
  // ho odhadem nelze: špatný scope = `scope-denied`, tedy ticho. Ať to člověk
  // zavede znovu — otisk se přitom nezmění jen tehdy, když klíč zůstane, a ten
  // zůstat NEMŮŽE, protože schválená hodnota scope je součást toho, co správce
  // schvaloval.
  if (!p.scope) {
    throw new Error(`${KLIC_POVERENI}: uložené pověření nemá scope (starý formát). Zapomeň zařízení a zaveď je znovu.`);
  }
  zkontrolujVerejnyKlic(p.publicKeyHex);
  return {
    kid: p.kid ?? kidZKlice(p.publicKeyHex),
    privateKeyPem: p.privateKeyPem,
    publicKeyHex: p.publicKeyHex,
    scope: p.scope,
  };
}

/**
 * Vrátí pověření tohoto zařízení; při prvním volání ho vyrobí a uloží.
 *
 * ⛔ NIKDY NEPŘEPÍŠE EXISTUJÍCÍ. Nový pár by znamenal novou identitu, tedy
 * ztrátu schválení — a uživatel by netušil proč. Když je uložené něco
 * nečitelného, raději SELŽE, než aby mlčky vyrobilo nové: tichá výměna klíče
 * je k nerozeznání od útoku.
 */
export async function povereniZarizeni(
  uloziste: UlozisteKlicu,
  krypto: KryptoZarizeni,
  scope: string,
): Promise<PovereniZarizeni> {
  // Scope se NEDOSAZUJE. Prázdný by u ověření znamenal rámec, který roster
  // nikdy nepřijme — a zařízení by mlčky neťukalo, aniž by kdo tušil proč.
  if (!scope) throw new Error("povereniZarizeni: scope je povinný — bez něj vyrobím průkaz, který vrátný vždy odmítne");
  const ulozene = await uloziste.precti(KLIC_POVERENI);
  if (ulozene !== null) return rozeberUlozene(ulozene);

  const { privateKeyPem, publicKeyHex } = krypto.novyPar();
  // Vadný pár se NEUKLÁDÁ. Uložit ho znamená zabetonovat chybu: `povereniZarizeni`
  // příště existující záznam nepřepíše, takže by se telefon už nikdy sám neopravil.
  zkontrolujVerejnyKlic(publicKeyHex);
  const vysledek: PovereniZarizeni = { kid: kidZKlice(publicKeyHex), privateKeyPem, publicKeyHex, scope };
  await uloziste.zapis(KLIC_POVERENI, JSON.stringify(vysledek));
  return vysledek;
}

/** Zapomenutí zařízení. Po něm ťuká zase člověk — a to je zamýšlené chování. */
export async function zapomenZarizeni(uloziste: UlozisteKlicu): Promise<void> {
  await uloziste.smaz(KLIC_POVERENI);
}
