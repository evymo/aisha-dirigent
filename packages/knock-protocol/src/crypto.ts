/**
 * Krypto se PŘEDÁVÁ zvenčí, nedováží se.
 *
 * ⭐ PROČ
 * Formát zaťukání má tři konzumenty s různým běhovým prostředím: brána (Node),
 * samostatný UDP kontejner (Node) a mobilní aplikace (React Native). RN nemá
 * `node:crypto`. Kdyby si balíček krypto importoval sám, buď by v appce
 * nenaběhl, nebo by si appka nesla vlastní kopii formátu — a dvě kopie
 * drátového formátu se dřív nebo později rozejdou.
 *
 * Rozhraní je proto co nejužší: JEDNA hašovací operace a zdroj náhody.
 *
 * ⭐ PROČ JEN SHA-256, KDYŽ RFC 4226 MLUVÍ O SHA-1
 * Aby konzument nepotřeboval dvě různé hašovací funkce. RFC 6238 SHA-256
 * výslovně dovoluje a bezpečnostně je to krok nahoru, ne dolů. PoC
 * (`artefakty/spa-poc/spa-protocol.mjs`) používá SHA-1; nic nasazeného zatím
 * není, takže se to sjednocuje TEĎ, dokud je to zadarmo.
 */

export interface KnockCrypto {
  /** HMAC-SHA256(klíč, zpráva) → 32 bajtů. */
  hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array;
  /** Kryptograficky silná náhoda — pro nonce. */
  randomBytes(n: number): Uint8Array;
  /**
   * scrypt(heslo, sůl) → `length` bajtů. VOLITELNÉ: rámec ho nepotřebuje
   * (podepisuje jen HMAC), sahá po něm výhradně odvození klíčů z KÓDU ČLOVĚKA
   * (`deriveFromPassword`). Konzument, který kód člověka nedělá (samotný UDP
   * kontejner), ho nemusí dodat.
   *
   * ⭐ SYNCHRONNÍ SCHVÁLNĚ. Odvození se dělá právě jednou, při zadání kódu, a
   * jeho výsledek je jediný vstup do zaťukání — asynchronní varianta by jen
   * přidala stav navíc bez užitku. Node `scryptSync` i quick-crypto `scryptSync`
   * tuhle signaturu mají.
   *
   * `opts.maxmem` musí projít až sem: quick-crypto v React Native má výchozí
   * strop 32 MB, kdežto náš KDF (N=16384, r=8) potřebuje 128*r*N = 16 MB práce +
   * režii, takže bez zvednutého stropu odvození na telefonu SPADNE. Node má
   * default vyšší, ale spoléhat na rozdíl mezi platformami = tichá past.
   */
  scryptSync?(
    password: Uint8Array,
    salt: Uint8Array,
    length: number,
    opts: { N: number; r: number; p: number; maxmem: number },
  ): Uint8Array;

  /**
   * Ověří ECDSA P-256 podpis nad SHA-256 otiskem zprávy. VOLITELNÉ: potřebuje ho
   * jen OVĚŘOVATEL rámce VER 2 (brána, UDP kontejner). Odesílatel ho nemá.
   *
   * ⭐ ROZHRANÍ SE TÍM ZÁMĚRNĚ ROZŠIŘUJE, a je to porušení zásady „co nejužší"
   * z hlavičky tohoto souboru. Důvod: Secure Enclave symetrický klíč držet NEUMÍ
   * — drží výhradně soukromé klíče P-256 a podepisuje jimi. Požadavek „klíč
   * nikdy neopustí telefon" proto NELZE splnit HMACem: server by klíč musel
   * vyrobit a poslat, čímž vznikne okamžik, kdy průkaz zařízení leží v jeho
   * paměti. Asymetrická operace není pohodlí, je to jediná cesta k té vlastnosti.
   *
   * ⛔ ZDE NENÍ PROTĚJŠEK `sign`. Podepisování se do tohoto rozhraní NESMÍ dostat:
   * jakmile by balíček uměl podepsat, musel by někde vzít soukromý klíč — a tvrzení
   * „klíč neopustí telefon" by popíral vlastní kód. Odesílatel proto předává
   * `encodeFrameDevice` FUNKCI, která podepíše (viz `frame.ts`), ne klíč.
   *
   * `publicKey` je nekomprimovaný bod SEC1 (0x04 || X(32) || Y(32)), `signature`
   * je 64 bajtů (r||s), tedy tvar, který vrací WebCrypto i Secure Enclave.
   */
  ecdsaP256Verify?(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean;
}
