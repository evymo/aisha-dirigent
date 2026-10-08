/**
 * Protokol společné lane (accel-plane) na sdíleném GPU uzlu.
 *
 * Lane servíruje modely víc forkům (nájemcům) najednou. Před obsluhou bází stojí
 * vynucovací bod (svc-accel-vstup) a na straně forku jeho tenký klient
 * (svc-lane-klient). Oba MUSÍ mluvit stejnými kódy: fork podle kódu rozhoduje,
 * jestli funkce stojí (lane startuje, je nedostupná) nebo jestli udělal chybu sám.
 *
 * SLOVNÍK JE UZAVŘENÝ (vzor services/svc-plugin-system/src/routes/broker.ts):
 * kód existuje jen tehdy, když ho vydává nějaká větev kódu, a každý kód má jeden
 * HTTP stav. Kód „do zásoby“ je mrtvé slovo — brána slovníku ho shodí (MJ24
 * kontraktu jádra 0c). Tělo odmítnutí je vždy `{ duvod, error }`, `duvod` první.
 *
 * Značky v závorkách odkazují na kontrakt jádra lane (R5a, PT2, Q2/Q3, MJ24)
 * a na kontrakt oddělení nájemců (I1–I8, V1–V3, X2/X3).
 */

/** Důvody odmítnutí → HTTP stav. Pořadí = pořadí v návrhu (§1.8). */
export const DUVODY_ODMITNUTI = Object.freeze({
  /** Požadavek bez klíče (I1). */
  KLIC_CHYBI: 401,
  /** Klíč nepatří žádnému nájemci, nebo je po rotaci neplatný (I2, I7). */
  KLIC_NEPLATNY: 401,
  /** Klíč patří JINÉMU nájemci, než jehož vstupem požadavek přišel (I3, I4). */
  KLIC_JINEHO_VSTUPU: 403,
  /** Požadavek přišel na adresu, kterou deklarace nezná, nebo z cizí podsítě (I8, weak host). */
  VSTUP_NEZNAMY: 403,
  /** Nájemce je vypnutý v deklaraci uzlu (místní vypínač) nebo jeho vstup chybí (X2). */
  NAJEMCE_VYPNUT: 403,
  /** Deklaraci uzlu nejde přečíst nebo ověřit — nikdo neví, kdo smí (X3). */
  DEKLARACE_NECITELNA: 503,
  /** Klient poslal pole, které vlastní platforma (sůl cache, identita, prostor jmen) (I5, V3, PT2). */
  POLE_PLATFORMY: 400,
  /** Tvar požadavku mimo seznam povolených polí, nebo chybí povinná třída. */
  POZADAVEK_NEPLATNY: 400,
  /** Cesta, kterou vynucovací bod nepropouští (I6; mj. /v1/load_lora_adapter). */
  CESTA_NEZNAMA: 404,
  /** Model nebo alias, který nájemce nemá (V2). */
  MODEL_NENALEZEN: 404,
  // Fáze 2 přidá ADAPTER_NEPRIJAT (alias adaptéru na embedderu, EM1) a
  // ADAPTER_SHA_NESOUHLASI (A1) — až s větví, která je vydá. Ve fázi 1 přijde adaptér
  // jen parametrem `lora_request` nebo jménem s prostorem jmen = POLE_PLATFORMY.
  /** Engine odmítl tvar vstupu (delší než okno, E3) — bez ozvěny obsahu. */
  ENGINE_ODMITL: 400,
  /** Nájemce nemá deklarovanou kvótu (Q2) — nikdy „neomezeno“. */
  KVOTA_CHYBI: 403,
  /** Kvóta nájemce vyčerpaná (Q3) — dopadá jen na něj. */
  KVOTA_PREKROCENA: 429,
  /** Počítadlo spotřeby nejde zapsat — požadavek se nepustí nezapočtený (Q2, MJ19). */
  POCITADLO_NEDOSTUPNE: 503,
  /** Lane přijala spojení, ale ještě není připravená (startuje nebo se zahřívá) (R5a). */
  LANE_STARTUJE: 503,
  /** Lane neodpovídá, odmítla spojení, nebo je vypnutá (R5a, R5b). */
  LANE_NEDOSTUPNA: 503,
} as const);

export type Duvod = keyof typeof DUVODY_ODMITNUTI;

export const SEZNAM_DUVODU: readonly Duvod[] = Object.freeze(Object.keys(DUVODY_ODMITNUTI) as Duvod[]);

/** Je hodnota kódem ze slovníku? Cokoli jiného je chyba protokolu (MJ24). */
export function jeDuvod(x: unknown): x is Duvod {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(DUVODY_ODMITNUTI, x);
}

/**
 * Kdo odmítl: vynucovací bod lane, klient tenkého stacku forku, nebo most modelového
 * meshe u forku (most-proxy odmítá `LANE_NEDOSTUPNA`, když uzel není v meshi vidět).
 */
export type Odmitl = 'vstup' | 'klient' | 'most';

export const HLAVICKY = Object.freeze({
  /** Kdo odmítl (pravidlo 2 kontraktu oddělení v2). */
  ODMITL: 'x-aisha-odmitl',
  /** Třída požadavku nájemce: `dotaz` (interaktivní) | `davka` (přepočet). Povinná (R3). */
  TRIDA: 'x-aisha-trida',
  /** Identita vah v odpovědi: `<formát>:<sha256>` (EM2). */
  IDENTITA: 'x-aisha-identita',
  /** Revize modelu v odpovědi (EM2). */
  REVIZE: 'x-aisha-revize',
  /** Recept, který drží lane (pooling, normalizace, max tokenů, ořez) (EM2). */
  RECEPT: 'x-aisha-recept',
  /** Spotřeba GPU v ms přiřazená identitě vstupu (Q1). */
  GPU_MS: 'x-aisha-gpu-ms',
  /**
   * Překročené kvóty nájemce v režimu `varovani` (deklarace uzlu kvoty.rezim): požadavek prošel,
   * ale nad mez — seznam kvót oddělený čárkou (`gpu_ms_za_okno`, `soubeh.<třída>`, `davka_max_vstupu`).
   * V režimu `vynucovat` se nevydává: tam překročení = 429 KVOTA_PREKROCENA.
   */
  KVOTA: 'x-aisha-kvota',
} as const);

/** Třídy požadavku. Výchozí hodnota se nedosazuje — chybějící třída je POZADAVEK_NEPLATNY. */
export const TRIDY = Object.freeze(['dotaz', 'davka'] as const);
export type Trida = (typeof TRIDY)[number];

export interface TeloOdmitnuti {
  duvod: Duvod;
  error: string;
  /** Jméno pole platformy, které klient poslal (nikdy jeho hodnota). */
  pole?: string;
  /** Která kvóta došla. */
  kvota?: string;
}

/**
 * Odmítnutí: HTTP stav ze slovníku a tělo `{ duvod, error, … }`. Neznámý kód je
 * výjimka, ne „500 s textem“ — slovník je uzavřený.
 */
export function odmitnuti(duvod: Duvod, error: string, navic: Omit<TeloOdmitnuti, 'duvod' | 'error'> = {}): { status: number; telo: TeloOdmitnuti } {
  if (!jeDuvod(duvod)) throw new Error(`accel-protokol: kód '${String(duvod)}' není ve slovníku DUVODY_ODMITNUTI`);
  return { status: DUVODY_ODMITNUTI[duvod], telo: { duvod, error, ...navic } };
}
