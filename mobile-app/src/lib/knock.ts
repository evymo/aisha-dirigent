/**
 * Zaťukání na dveře z telefonu — jeden UDP datagram, žádná odpověď.
 *
 * TÝŽ PROTOKOL JAKO SERVER. Rámec skládá `@aisha/knock-protocol`, tedy tentýž
 * balíček, který na druhé straně ověřuje `svc-knock`. Jádro balíčku schválně
 * neimportuje `node:crypto` ani `Buffer` — primitiva se INJEKTUJÍ, proto běží
 * i tady. Kdyby si appka formát psala sama, měli bychom dvě pravdy o tom, co
 * je platné zaťukání, a rozešly by se při první změně.
 *
 * ⭐ ODPOVĚĎ NEPŘIJDE A NESMÍ SE NA NI ČEKAT.
 * Dveře mlčí i při úspěchu (invarianty K2/T3): přijetí a odmítnutí vypadají
 * zvenčí identicky, jako zavřený port. To je celá jejich nenápadnost. UI proto
 * NESMÍ tvrdit „otevřeno" — smí říct jen „zaťukáno" a pravdu ověřit tím, že
 * projde další požadavek na API. Kdo si sem doplní potvrzení od serveru, zahodí
 * vlastnost, kvůli které dveře existují.
 *
 * ⭐ TENHLE SOUBOR JE ČISTÝ: nezná nativní moduly. Primitiva (`KnockCrypto`) a
 * odeslání datagramu se INJEKTUJÍ přes `KnockDeps`, takže logika jde testovat
 * bez zařízení. Nativní adaptér (`react-native-udp`, `react-native-quick-crypto`)
 * bydlí v `knock-native.ts` — jediné místo, kde se ty závislosti linkují, a
 * jediný důvod, proč appka potřebuje nový nativní build.
 */
import { encodeFrame, encodeFrameDevice, totp, hexToBytes, deriveFromPassword, type KnockCrypto } from '@aisha/knock-protocol';

/** Pověření tohoto zařízení. Uloženo v bezpečném úložišti, NIKDY v AsyncStorage. */
export interface KnockCredential {
  kid: string;
  hmacKeyHex: string;
  otpSeedHex: string;
  /** Kam se klepe. Instanční hodnota, ne konstanta. */
  host: string;
  port: number;
  scope: string;
}

export interface KnockDeps {
  /** Krypto primitiva platformy — na RN typicky `react-native-quick-crypto`. */
  crypto: KnockCrypto;
  /** Odeslání datagramu. Vrací se po ODESLÁNÍ, ne po doručení — UDP nepotvrzuje. */
  sendDatagram: (bytes: Uint8Array, host: string, port: number) => Promise<void>;
  /** Sekundy od epochy. Injektované, aby šel čas v testu posunout. */
  nowSec: () => number;
}


/** Co se stalo. `sent` NEZNAMENÁ „otevřeno" — jen „datagram odešel". */
export interface KnockResult {
  sent: boolean;
  kid: string;
  /** Diagnostika pro podporu; do UI nepatří. */
  nonceHex?: string;
  error?: string;
}

/**
 * Zaťuká jednou.
 *
 * Chyba se NEPOLYKÁ: když datagram neodejde (letadlový režim, DNS), uživatel to
 * musí vědět — jinak bude koukat na appku, která „zaťukala" a nic se neděje.
 * Rozdíl mezi „neodeslal jsem" a „odeslal a dveře mlčí" je jediný, který klient
 * poznat MŮŽE, takže ho musí hlásit přesně.
 */
export async function knockOnce(
  cred: KnockCredential,
  deps: KnockDeps,
): Promise<KnockResult> {
  try {
    const ts = deps.nowSec();
    const otp = totp(deps.crypto, hexToBytes(cred.otpSeedHex), ts);
    // `otp` je SOUČÁST podepisovaného vstupu, ne příloha vedle něj — server ho
    // ověřuje uvnitř rámce. Vynechat ho tady znamená rámec, který projde
    // překladačem a server ho odmítne jako `bad-hmac`.
    const { frame, nonceHex } = encodeFrame(
      deps.crypto,
      { kid: cred.kid, ts, scope: cred.scope, otp },
      hexToBytes(cred.hmacKeyHex),
    );
    await deps.sendDatagram(frame, cred.host, cred.port);
    return { sent: true, kid: cred.kid, nonceHex };
  } catch (e) {
    return { sent: false, kid: cred.kid, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Kam se klepe a pod jakým kid — instanční hodnoty, ne konstanty v kódu. */
export interface KnockTarget {
  kid: string;
  host: string;
  port: number;
  scope: string;
}

/**
 * KÓD ČLOVĚKA → jedno zaťukání.
 *
 * ⭐ VOLÁ SE VÝHRADNĚ NA VÝSLOVNÝ ÚKON UŽIVATELE (zadal kód a stiskl „zaklepat").
 * Ťukat smí jen člověk a vědomě — nikdy ne appka sama z lifecycle, po loginu ani
 * z retry smyčky (zákon instance). Případná automatika by musela být za výslovným
 * parametrem; výchozí stav je ruční, a tahle funkce žádnou smyčku nemá.
 *
 * ⭐ KÓD SE NEUKLÁDÁ. Odvodí se z něj materiál pověření, tím se zaťuká, a kód i
 * odvozené klíče zůstanou jen v tomhle volání — na rozdíl od pověření ZAŘÍZENÍ
 * (náhodné klíče), které se do secure-store uloží. Kód je cesta break-glass a
 * onboarding: funguje i před přihlášením a nic po sobě nenechá.
 */
export async function knockWithCode(
  code: string,
  target: KnockTarget,
  deps: KnockDeps,
): Promise<KnockResult> {
  try {
    const { hmacKeyHex, otpSeedHex } = deriveFromPassword(deps.crypto, code, target.kid);
    return await knockOnce({ ...target, hmacKeyHex, otpSeedHex }, deps);
  } catch (e) {
    // Selhání odvození (chybí scrypt, prázdný kód) se hlásí stejně jako selhání
    // odeslání — uživatel musí vědět, že se NEZAŤUKALO.
    return { sent: false, kid: target.kid, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * PRŮKAZ ZAŘÍZENÍ → jedno zaťukání (VER 2).
 *
 * ⭐ TOHLE JE JEDINÁ AUTOMATICKÁ CESTA A JE ZÁMĚRNĚ ÚZKÁ. Zákon instance zní
 * „ťuká vždy jen člověk"; výjimka platí pro zařízení, které člověk zavedl a
 * správce SCHVÁLIL. Brána té výjimky je proto EXISTENCE PRŮKAZU, ne přepínač
 * v kódu — a průkaz smí založit jen výslovný lidský úkon (`povereniZarizeni`),
 * nikdy automatika, která ho čte (`nactiPovereni`). Kdyby si ho automatika
 * mohla vyrobit, měl by ho každý telefon a podmínka by nic neznamenala.
 *
 * ⛔ NEBERE SOUKROMÝ KLÍČ, BERE PODPISOVOU FUNKCI — týž důvod jako
 * `encodeFrameDevice`: tvrzení „klíč neopustí telefon" nesmí popírat vlastní
 * podpis funkce. Na zařízení ji obslouží nativní adaptér, v testu náhrada.
 *
 * ⛔ VOLAT NEJVÝŠ JEDNOU ZA POKUS. Rozhoduje o tom `dalsiKrokDveri`
 * (`lib/dvereEskalace.ts`), ne tahle funkce — smyčka, která ťuká po každém
 * neúspěchu, si sama vyrobí cooldown 300 s na dveřích, které otevírá.
 * `sent: true` ani tady NEZNAMENÁ „otevřeno": dveře mlčí i při úspěchu.
 */
export async function knockAsDevice(
  zarizeni: { kid: string; podepis: (zprava: Uint8Array) => Uint8Array },
  cil: Omit<KnockTarget, 'kid'>,
  deps: KnockDeps,
): Promise<KnockResult> {
  try {
    // OTP se neposílá — u VER 2 v rámci není. Nahrazuje ho podpis, který kryje
    // `TS` i `NONCE`, takže opakování řeší okno a evidence nonců na druhé straně.
    const { frame, nonceHex } = encodeFrameDevice(
      deps.crypto,
      { kid: zarizeni.kid, ts: deps.nowSec(), scope: cil.scope },
      zarizeni.podepis,
    );
    await deps.sendDatagram(frame, cil.host, cil.port);
    return { sent: true, kid: zarizeni.kid, nonceHex };
  } catch (e) {
    return { sent: false, kid: zarizeni.kid, error: e instanceof Error ? e.message : String(e) };
  }
}
