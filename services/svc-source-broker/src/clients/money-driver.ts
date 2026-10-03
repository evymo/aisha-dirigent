/**
 * MONEY → INGEST. Doklady z účetnictví do ingestu, cestou, kterou určil majitel
 * 2026-08-29: „doklady tlačí broker přes API ingestu, jen v rámci stacku, meshe".
 *
 * ── TŘI MĚŘENÍ, KTERÁ TENHLE SOUBOR TVARUJÍ (2026-08-31, produkce) ──────────
 *
 * ⛔ 1. VÝPŮJČKA TUNELU SE DRŽÍ PO CELÝ BĚH.
 *    Bez ní se VPN otevírá a zavírá kolem každého dotazu a agendy padají na
 *    `401 invalid_client` / `fetch failed`. Nahlásil jsem to jako vadu
 *    dodavatele — ŠPATNĚ: s drženou výpůjčkou odpovědělo VŠECH ŠEST.
 *
 * ⛔ 2. FILTR FUNGUJE — A TVRZENÍ O OPAKU STÁLO 86 % DODACÍCH LISTŮ.
 *    Do 2026-09-14 tu stálo „Filter je na straně Money rozbitý" (15 tvarů,
 *    `Opeartor  is not valid` s PRÁZDNÝM operátorem). Prázdný operátor byl
 *    nápověda: parser Money S5 čte `Pole~operátor~hodnota`. Naměřeno v produkci:
 *      `Filter:"DatumVystaveni~gte~2026-09-10"`  → 42 dokladů
 *      `Filter:"CisloDokladu~eq~DLP2602306"`     → 1 doklad
 *    Stránkování je `From:N, Count:M` (používá ho i sonda svc-money); `OrderBy`
 *    Money nezná. Bez argumentů vrací rejstřík PRVNÍCH 1000 řádků v pořadí
 *    interního ID — napříč lety 2021–2026. Tah tak viděl náhodný vzorek:
 *    z 3 103 dodacích listů roku 2026 dorazilo 438 (14,1 %).
 *
 * ⭐ 3. TVAR TAHU — ŠETRNĚ K ZDROJI: FILTROVANÝ REJSTŘÍK → ROZDÍL → DETAIL.
 *      a) rejstřík JEN od data (`DatumVystaveni~gte~since`), 3 pole; stránka
 *         navíc je výjimka, ne pravidlo
 *      b) rozdíl proti dokladům, které už byly DORUČENY (klíč agenda/druh/ID)
 *      c) plný doklad (`IssuedDeliveryNote(ID: "…")`) JEN pro nové kusy
 *    Běžný tik = jeden malý dotaz na agendu a druh, detail jen pro novinky.
 *
 * ⛔ `errors: []` JE V JS PRAVDIVÉ. Podmínka musí být `errors?.length`, jinak
 *    fungující cesta hlásí chybu (naměřeno — obrátilo mi to výsledek u všech
 *    šesti agend).
 *
 * Pověření agend zůstávají v `svc-money`; broker zná jen jeho adresu a token.
 */
import type { FastifyBaseLogger } from 'fastify';

/** Druh dokladu = ENTITA v Money + značka pro engine. Data, ne větvení v kódu. */
export interface MoneyDocKind {
  /** Množinová entita pro rejstřík, např. `IssuedDeliveryNotes`. */
  listEntity: string;
  /** Jednotná entita pro detail, např. `IssuedDeliveryNote`. */
  itemEntity: string;
  /** Značka, podle níž engine pozná druh (`money.dodaci_list`). */
  marker: string;
  /** Pole plného dokladu — GraphQL výběr, jak ho engine očekává. */
  detailFields: string;
  /** Směr dokladu pro engine (`_subtype` → `document_subtype`), např. `issued`. */
  podtyp?: string;
  /**
   * Jméno souboru = IDENTITA dokladu v registru (`li_upsert_source_registry` překlíčuje
   * podle `filename`). `agenda-cislo` = `<agenda>-<číslo>.json` (dodací listy od 09-14);
   * `znacka-cislo-id` = `money-<druh>-<číslo>-<ID[0:8]>.json`, tedy TÝŽ tvar, jaký nese
   * 23 728 faktur z exportu 2026-08-06. Jiné jméno pro týž doklad = druhý řádek registru.
   */
  nazev?: 'agenda-cislo' | 'znacka-cislo-id';
  /**
   * JMÉNO, KTERÉ REGISTR UŽ ZNÁ, MÁ PŘEDNOST. Týž doklad Money nese v registru historicky
   * různá jména: export 2026-08-06 (`money-<druh>-…`), dřívější tah téhle linky
   * (`<agenda>-<číslo>.json`, někdy s příponou `-10`, kterou ze vzorce odvodit NEJDE)
   * a exportní jméno se starším číslem dokladu. Naměřeno 2026-09-25: první den tahu faktur
   * po jménu exportu založil 164 druhých řádků k fakturám známým jen pod dřívějším jménem.
   * Proto se před doručením zeptáme registru podle `money_id` (`docType` = `doc_type`
   * v registru) a doklad doručíme pod jménem, které už má. Viz `vyberJmeno`.
   * ⛔ OPRAVA 2026-09-26: „přepíše na místě" NEPLATÍ — ingest `/api/upload` existující soubor
   * nepřepisuje a změnu uloží jako `<jméno>-N` (nový řádek). Dvojice tedy tohle nezastaví;
   * verze téhož záznamu sjednocuje engine podle `doc_identity` (money_id → supersedes).
   */
  jmenoZRegistru?: { docType: string };
  /**
   * ZMĚNY MÍSTO NOVINEK. Doklad, jehož stav se mění i po vystavení (faktura: úhrady),
   * se nesmí doručit jen jednou. Rejstřík se pak ptá `ChangeFrom` (změněné od okna,
   * včetně STARÝCH dokladů) a detail se stáhne, když se změnil `podpis` — pole rejstříku,
   * jejichž změna znamená nový stav dokladu.
   */
  zmeny?: { podpis: readonly string[] };
}

export interface MoneyAgenda {
  key: string;
  /** Čitelné jméno agendy ze svc-money (`/agendas`). */
  label?: string;
}

export interface MoneyPullOptions {
  /** Nejstarší datum vystavení, které nás zajímá (YYYY-MM-DD). */
  since: string;
  /** Okno pro konkrétní agendu a druh (kurzor po dvojicích); bez něj platí `since`. */
  sinceFor?: (agenda: string, marker: string) => string;
  /** Už doručené doklady — klíče `klicDokladu(agenda, druh, ID)`. Rozdíl se dělá proti nim. */
  known: ReadonlySet<string>;
  /** Strop nových dokladů na jeden běh; chrání protistranu i nás. */
  maxNew: number;
  /**
   * Firma, ze které doklady agendy jsou (`_instance` → `owner_company`). Bez ní engine
   * doklad nepřiřadí k firmě — a osa pohledu „podle firmy" ho nevidí.
   */
  firma?: (agenda: MoneyAgenda) => string | null;
  /** Den tahu (YYYY-MM-DD) — datum doručení u dokladů, které se táhnou po změnách. */
  datumTahu?: string;
  /**
   * Jména, pod nimiž registr doklady už zná: `money_id` → jména souborů (jen čtení).
   * Povinné pro druh s `jmenoZRegistru` — bez něj by doručení zakládalo druhé řádky.
   */
  jmenaVRegistru?: (ids: readonly string[], docType: string) => Promise<ReadonlyMap<string, readonly string[]>>;
}

/**
 * Pod jakým jménem doklad doručit. Vypočtené jméno (tvar exportu), pokud ho registr zná
 * nebo nezná žádné; jediné jiné známé jméno má přednost (aktualizace na místě); víc
 * známých jmen, z nichž žádné není vypočtené, je NEJASNÉ — doklad se nedoručí a ohlásí,
 * protože kterékoli rozhodnutí by bylo hádání (a třetí jméno by přidalo další řádek).
 */
export function vyberJmeno(
  vypoctene: string,
  znama: readonly string[] | undefined,
): { jmeno: string } | { nejasne: readonly string[] } {
  if (!znama || znama.length === 0 || znama.includes(vypoctene)) return { jmeno: vypoctene };
  if (znama.length === 1) return { jmeno: znama[0]! };
  return { nejasne: znama };
}

export interface MoneyAgendaResult {
  agenda: string;
  kind: string;
  /** Kolik řádků vydal (filtrovaný) rejstřík. */
  windowRows: number;
  /** true = stránkování narazilo na pojistku `MAX_STRANEK`, takže za její okraj NEVIDÍME. */
  windowCapped: boolean;
  /** Kolik z okna ještě nebylo doručeno. */
  fresh: number;
  /**
   * Plně stažené doklady; `klic` a `datum` vedou kurzor doručených. U novinek je `datum`
   * datum vystavení, u změn den tahu (starý doklad změněný dnes musí okno přežít).
   */
  documents: Array<{ name: string; body: string; id: string; datum: string; klic: string }>;
  /** Nové doklady nad strop běhu — přijdou příště (tah proto neposune kurzor). */
  odlozeno: number;
  /**
   * Doklady UVNITŘ stropu, jejichž detail se nepodařilo načíst. ⛔ Nesmí se ztratit tiše:
   * dvojice s přeskočeným kusem není úplná, kurzor se neposune a příští tah kus zkusí znovu
   * (není v `known`). Nalezeno recenzí aisha-team 2026-09-23 — do té doby se kus nepočítal.
   */
  preskoceno?: number;
  /** Z toho kusů s nejasným jménem v registru (víc jmen, žádné vypočtené) — viz `vyberJmeno`. */
  nejasnaJmena?: number;
  /** Okno, se kterým se tahle agenda a druh táhly. */
  since?: string;
  /** Klíč, pod kterým se vede kurzor `od` této dvojice (viz `klicKurzoru`). */
  kurzor?: string;
  /** Nedostupná agenda — NE prázdná. Viz `probeReachable`. */
  unreachable: boolean;
  error?: string;
}

/** Stránka rejstříku. Rejstřík je filtrovaný datem, takže druhá stránka je výjimka. */
const STRANKA = 500;
/** Pojistka stránkování: kdyby filtr přestal filtrovat, nestáhne se celý rejstřík. */
export const MAX_STRANEK = 20;

/** Klíč doručeného dokladu. ID je GUID v rámci agendy; druh ho odděluje od jiné entity. */
export function klicDokladu(agenda: string, marker: string, id: string): string {
  return `${agenda}/${marker}/${id}`;
}

/** Klíč dvojice agenda/druh — pod ním se vede kurzor `od`. */
export function klicDvojice(agenda: string, marker: string): string {
  return `${agenda}/${marker}`;
}

/**
 * Klíč kurzoru dvojice. Tah PO ZMĚNÁCH má vlastní kurzor: okno „vystaveno od" a okno
 * „změněno od" jsou jiné veličiny — kurzor novinek z dřívějška by změnám tiše uřízl
 * historii (naměřeno 2026-09-23: faktury měly kurzor novinek 2026-09-19, úhrady od
 * 2026-08-06 by se tak nikdy nedotáhly).
 */
export function klicKurzoru(agenda: string, kind: Pick<MoneyDocKind, 'marker' | 'zmeny'>): string {
  return kind.zmeny ? `${klicDvojice(agenda, kind.marker)}#zmeny` : klicDvojice(agenda, kind.marker);
}

/** Filtr rejstříku od data vystavení. Datum se ověřuje — do dotazu nesmí projít nic jiného. */
export function filtrOdData(since: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error(`money-driver: neplatné datum okna '${since}'`);
  return `DatumVystaveni~gte~${since}`;
}

/**
 * `ChangeFrom` je `DateTime`, ne datum: naměřeno 2026-09-23, že `"2026-09-16"` Money
 * odmítne („Expected type 'DateTime'"), `"2026-09-16T00:00:00"` vrátí změněné doklady
 * VČETNĚ starších faktur, u nichž se změnila jen úhrada (35 z 35 u jedné agendy).
 */
export function zmenyOd(since: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error(`money-driver: neplatné datum okna '${since}'`);
  return `${since}T00:00:00`;
}

/** Podpis řádku rejstříku — hodnoty polí, jejichž změna znamená nový stav dokladu. */
export function podpisRadku(podpis: readonly string[], r: Record<string, unknown>): string {
  return podpis.map((p) => String(r[p] ?? '')).join('|');
}

/** Klíč doručené VERZE dokladu: týž doklad s jiným podpisem je nová verze. */
export function klicZmeny(agenda: string, marker: string, id: string, podpis: string): string {
  return `${klicDokladu(agenda, marker, id)}#${podpis}`;
}

/** Jméno souboru v ingestu. Viz `MoneyDocKind.nazev` — jméno JE identita dokladu. */
export function nazevSouboru(
  kind: Pick<MoneyDocKind, 'marker' | 'nazev'>,
  agenda: string,
  cislo: string | undefined,
  id: string,
): string {
  if (kind.nazev === 'znacka-cislo-id') {
    // Tvar exportu 2026-08-06: `money-faktura_vydana-VF19033-b6601e85.json` — ne-[A-Za-z0-9._-]
    // v čísle → `_` (změřeno na 15 911 vydaných fakturách, shoda 15 911/15 911).
    const druh = kind.marker.replace(/^money\./, '');
    const c = (cislo || id).replace(/[^A-Za-z0-9._-]/g, '_');
    return `money-${druh}-${c}-${id.slice(0, 8)}.json`;
  }
  return `${bezpecneJmeno(agenda)}-${bezpecneJmeno(cislo ?? id)}.json`;
}

export interface MoneyClient {
  query(agenda: string, query: string): Promise<{ data?: Record<string, unknown>; errors?: unknown[] }>;
  lease(): Promise<string>;
  release(leaseId: string): Promise<void>;
  /** Seznam agend ZE ZDROJE PRAVDY (`svc-money`), bez pověření. Broker si ho
   *  nedrží: druhá kopie by se rozešla a chybějící agenda by se projevila jako
   *  „nemá doklady", ne jako „nevíme o ní". */
  listAgendas(): Promise<MoneyAgenda[]>;
}

/** Nejdelší čekání na obnovu limitu svc-money, které tah ještě snese (pak je to chyba, ne pauza). */
export const MAX_CEKANI_NA_LIMIT_MS = 120_000;
/** Kolikrát se týž dotaz pošle, když ho odmítne limit, než se to přizná jako chyba. */
const POKUSU_PRI_LIMITU = 3;

/**
 * Sekundy z hlavičky (`x-ratelimit-*`, `retry-after`); cokoli jiného než nezáporné číslo = neznámo.
 * `retry-after` ve tvaru HTTP data se tedy nebere (bez opakování, fail-closed).
 */
function sekundy(h: string | null): number | null {
  if (h == null || !/^\d+(\.\d+)?$/.test(h.trim())) return null;
  return Number(h);
}

/**
 * Limit svc-money se obnoví později, než tah snese čekat. Nese to JEDNU příčinu pro
 * zbytek tahu — `pullAll` po ní další dvojice nedotazuje a označí je jako přeskočené,
 * aby člověk v logu neviděl N stejných „problémů" místo jednoho.
 */
export class LimitSvcMoneyNecekame extends Error {}

/**
 * Klient `svc-money`. Adresa ani token se NEODVOZUJÍ — bez nich je to STOP,
 * ne tichý přeskok (agenda bez pověření by jinak vypadala jako prázdná).
 *
 * ⛔ TEMPO URČUJE SERVER, NE BROKER. svc-money má limit dotazů a hlásí ho u KAŽDÉ
 * odpovědi (`x-ratelimit-limit/-remaining/-reset`; 2026-09-24: 60 za minutu).
 * Naměřeno 2026-09-24: první tah faktur po změnách od 2026-08-06 poslal 67 dotazů
 * za 1 s, limit došel, svc-money odmítnutí přebalil na `500 vnitřní chyba` a v tomtéž
 * tahu spadly i ŽIVÉ dodací listy všech agend. Klient proto před dotazem počká, když
 * server řekl, že zbývá 0, a odmítnutí limitem (429, nebo 5xx s `retry-after`)
 * zopakuje po udané době. Číslo limitu si NEDRŽÍ — změní-li se na serveru, platí nové.
 */
export function createMoneyClient(
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
  cekej: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ted: () => number = Date.now,
): MoneyClient {
  if (!baseUrl) throw new Error('money-driver: chybí adresa svc-money — cíl se NEODVOZUJE');
  if (!token) throw new Error('money-driver: chybí token — svc-money odmítá vše');
  const base = baseUrl.replace(/\/+$/, '');
  const auth = { authorization: `Bearer ${token}` };
  /** Do kdy server řekl „teď už nic" (ms epochy); v minulosti = volno. */
  let pauzaDo = 0;

  const odloz = (sekund: number): void => {
    pauzaDo = Math.max(pauzaDo, ted() + sekund * 1000 + 250);
  };

  /**
   * Požadavek s ohledem na limit serveru. Síťovou chybu ani jiné selhání NEopakuje.
   * `bezPauzy`: první pokus nečeká na pauzu z dřívějška (vrácení výpůjčky — odmítne-li
   * ho server limitem, počká se už jen na JEHO udanou dobu).
   */
  const posli = async (url: string, init: RequestInit, bezPauzy = false): Promise<Response> => {
    for (let pokus = 1; ; pokus += 1) {
      const zbyvaCekat = pauzaDo - ted();
      if (zbyvaCekat > 0 && !(bezPauzy && pokus === 1)) {
        if (zbyvaCekat > MAX_CEKANI_NA_LIMIT_MS) {
          throw new LimitSvcMoneyNecekame(
            `svc-money: limit dotazů se obnoví až za ${Math.ceil(zbyvaCekat / 1000)} s — tah tolik nečeká`);
        }
        await cekej(zbyvaCekat);
      }
      const r = await fetchImpl(url, init);
      const zbyva = sekundy(r.headers.get('x-ratelimit-remaining'));
      const reset = sekundy(r.headers.get('x-ratelimit-reset'));
      const retryAfter = sekundy(r.headers.get('retry-after'));
      if (zbyva === 0 && reset != null) odloz(reset);
      // 5xx se za limit považuje JEN s `retry-after` (dnešní svc-money přebaluje 429 na 500
      // i s hlavičkami — změřeno). Kdyby oprava svc-money vracela holou 500, opakování tu
      // přestane: obě strany jsou v tomhle bodě svázané.
      const odmitnutoLimitem = r.status === 429 || (r.status >= 500 && retryAfter != null);
      // Dobu čekání říká server; když ji neřekl, nehádá se — odmítnutí jde dál jako chyba.
      const doba = retryAfter ?? reset;
      if (!odmitnutoLimitem || doba == null || pokus >= POKUSU_PRI_LIMITU) return r;
      odloz(doba);
    }
  };

  return {
    async query(agenda, query) {
      const r = await posli(`${base}/query`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ agenda, query }),
      });
      const text = await r.text();
      if (!r.ok) throw new Error(`svc-money ${r.status}: ${text.slice(0, 200)}`);
      return JSON.parse(text) as { data?: Record<string, unknown>; errors?: unknown[] };
    },
    async lease() {
      const r = await posli(`${base}/lease`, { method: 'POST', headers: auth });
      const text = await r.text();
      if (!r.ok) throw new Error(`svc-money lease ${r.status}: ${text.slice(0, 200)}`);
      const { leaseId } = JSON.parse(text) as { leaseId?: string };
      if (!leaseId) throw new Error('svc-money lease: odpověď bez leaseId');
      return leaseId;
    },
    async listAgendas() {
      const r = await posli(`${base}/agendas`, { headers: auth });
      const text = await r.text();
      if (!r.ok) throw new Error(`svc-money agendas ${r.status}: ${text.slice(0, 200)}`);
      const { agendas } = JSON.parse(text) as { agendas?: Array<{ key?: string; label?: string }> };
      if (!Array.isArray(agendas) || agendas.length === 0) {
        throw new Error('svc-money nevydal žádnou agendu — prázdný seznam je STOP, ne prázdný tah');
      }
      return agendas.filter((a): a is { key: string; label?: string } => !!a.key)
        .map((a) => (typeof a.label === 'string' && a.label.trim() ? { key: a.key, label: a.label.trim() } : { key: a.key }));
    },
    async release(leaseId) {
      // ⛔ Vrácení výpůjčky se pošle VŽDY (bez čekání na dřívější pauzu) a neúspěch se
      // NEspolkne — nevrácená výpůjčka drží tunel do cizí sítě až do stropu života.
      // Ohlásí ho volající (`pullAll`), který má logger. (Recenze aisha-team cb 2026-09-24.)
      const r = await posli(`${base}/lease/${encodeURIComponent(leaseId)}`, { method: 'DELETE', headers: auth }, true);
      if (!r.ok) throw new Error(`svc-money release ${r.status}: ${(await r.text()).slice(0, 200)}`);
    },
  };
}

/**
 * Odpovídá agenda vůbec? MĚŘIDLO JE DOTAZ NA NEEXISTUJÍCÍ POLE.
 *
 * ⛔ Naměřeno 2026-08-31: tři agendy vracely `0` na doklady i na faktury —
 * a stejně tak na `Firms`, které v schématu NENÍ. Živá agenda takový dotaz
 * odmítne chybou schématu; spojení, které nikam nevede, vrátí prázdno.
 * Bez tohohle rozdílu se „nemá doklady" nedá odlišit od „nevede nikam" —
 * a mlčící zdroj je horší než hlasitě rozbitý.
 */
export async function probeReachable(client: MoneyClient, agenda: string): Promise<boolean> {
  const d = await client.query(agenda, '{ NeexistujiciEntitaProSondu { ID } }');
  return Array.isArray(d.errors) && d.errors.length > 0;
}

function bezpecneJmeno(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[.-]+/, '') || 'doklad';
}

/** Jeden běh nad jednou agendou a jedním druhem dokladu. */
export async function pullAgenda(
  client: MoneyClient,
  agenda: MoneyAgenda,
  kind: MoneyDocKind,
  opts: MoneyPullOptions,
  logger: FastifyBaseLogger,
): Promise<MoneyAgendaResult> {
  const vysledek: MoneyAgendaResult = {
    agenda: agenda.key, kind: kind.marker,
    windowRows: 0, windowCapped: false, fresh: 0, documents: [], unreachable: false, odlozeno: 0,
    since: opts.since, kurzor: klicKurzoru(agenda.key, kind),
  };

  if (!(await probeReachable(client, agenda.key))) {
    vysledek.unreachable = true;
    logger.error({ agenda: agenda.key },
      'money-driver: agenda MLČÍ — dotaz na neexistující pole nevrátil chybu schématu, ' +
      'spojení tedy nevede k Money. NENÍ to prázdná agenda.');
    return vysledek;
  }

  // Firma agendy se určí PŘED dotazy: doklad bez firmy by engine k firmě nepřiřadil
  // a osa pohledu by ho neviděla — to je vada, ne prázdná hodnota.
  const firma = opts.firma ? opts.firma(agenda) : undefined;
  if (opts.firma && !firma) {
    vysledek.error = `agenda ${agenda.key} nemá jméno firmy (agenda_companies ani label ze svc-money) — doklady by přišly bez owner_company`;
    logger.error({ agenda: agenda.key, kind: kind.marker }, `money-driver: ${vysledek.error}`);
    return vysledek;
  }

  // (a) levný rejstřík, po stránkách. Novinky: tři pole JEN od data vystavení.
  // Změny: `ChangeFrom` + pole podpisu — vrátí i starý doklad, kterému se změnila úhrada.
  const podpis = kind.zmeny?.podpis ?? [];
  const argumenty = kind.zmeny
    ? `ChangeFrom:${JSON.stringify(zmenyOd(opts.since))}`
    : `Filter:${JSON.stringify(filtrOdData(opts.since))}`;
  const pole = ['ID', 'CisloDokladu', 'DatumVystaveni', ...podpis].join(' ');
  const radky: Array<Record<string, string>> = [];
  for (let strana = 0; ; strana += 1) {
    if (strana >= MAX_STRANEK) {
      vysledek.windowCapped = true;
      break;
    }
    const index = await client.query(agenda.key,
      `{ ${kind.listEntity}(From:${strana * STRANKA}, Count:${STRANKA}, ${argumenty}) { ${pole} } }`);
    if (index.errors?.length) {
      vysledek.error = JSON.stringify(index.errors).slice(0, 200);
      return vysledek;
    }
    const stranka = (index.data?.[kind.listEntity] ?? []) as Array<Record<string, string>>;
    radky.push(...stranka);
    if (stranka.length < STRANKA) break;
  }
  vysledek.windowRows = radky.length;

  // (b) rozdíl proti doručeným. U novinek se hlídá i datum: kdyby filtr přestal filtrovat,
  // okno zůstane oknem (a pojistka stránek to ohlásí). U změn datum vystavení NEROZHODUJE —
  // starý doklad změněný v okně je přesně to, co se má doručit; rozhoduje podpis verze.
  const klicRadku = (r: Record<string, string>): string => (kind.zmeny
    ? klicZmeny(agenda.key, kind.marker, r.ID!, podpisRadku(podpis, r))
    : klicDokladu(agenda.key, kind.marker, r.ID!));
  const nove = radky.filter((r) => {
    if (!r.ID || opts.known.has(klicRadku(r))) return false;
    return kind.zmeny ? true : (r.DatumVystaveni ?? '').slice(0, 10) >= opts.since;
  });
  vysledek.fresh = nove.length;

  if (vysledek.windowCapped) {
    logger.warn({ agenda: agenda.key, kind: kind.marker, windowRows: radky.length, fresh: nove.length },
      `money-driver: rejstřík od ${opts.since} přesáhl ${MAX_STRANEK * STRANKA} řádků — za pojistku NEVIDÍME (filtr nefiltruje?)`);
  }

  // (c) plný doklad jen pro nové kusy — pod jménem, které registr už zná (viz `jmenoZRegistru`)
  const davka = nove.slice(0, opts.maxNew);
  let znamaJmena: ReadonlyMap<string, readonly string[]> | null = null;
  if (kind.jmenoZRegistru && davka.length > 0) {
    if (!opts.jmenaVRegistru) {
      throw new Error(`money-driver: druh ${kind.marker} vyžaduje dotaz na jména v registru — bez něj by vznikaly druhé řádky`);
    }
    znamaJmena = await opts.jmenaVRegistru(davka.map((r) => r.ID!), kind.jmenoZRegistru.docType);
  }
  for (const r of davka) {
    const vypoctene = nazevSouboru(kind, agenda.key, r.CisloDokladu, r.ID!);
    const volba = znamaJmena ? vyberJmeno(vypoctene, znamaJmena.get(r.ID!)) : { jmeno: vypoctene };
    if ('nejasne' in volba) {
      logger.error({ agenda: agenda.key, doklad: r.CisloDokladu, id: r.ID, jmena: volba.nejasne },
        'money-driver: doklad má v registru víc jmen a žádné není vypočtené — NEdoručuji (jinak by vznikl další řádek); čeká na sjednocení');
      vysledek.nejasnaJmena = (vysledek.nejasnaJmena ?? 0) + 1;
      vysledek.preskoceno = (vysledek.preskoceno ?? 0) + 1;
      continue;
    }
    const detail = await client.query(agenda.key,
      `{ ${kind.itemEntity}(ID: ${JSON.stringify(r.ID)}) { ${kind.detailFields} } }`);
    if (detail.errors?.length) {
      logger.warn({ agenda: agenda.key, doklad: r.CisloDokladu, chyba: JSON.stringify(detail.errors).slice(0, 120) },
        'money-driver: detail dokladu se nepodařilo načíst — kus se zkusí příští tah, kurzor dvojice stojí');
      vysledek.preskoceno = (vysledek.preskoceno ?? 0) + 1;
      continue;
    }
    const doklad = detail.data?.[kind.itemEntity] as Record<string, unknown> | undefined;
    if (!doklad) { vysledek.preskoceno = (vysledek.preskoceno ?? 0) + 1; continue; }
    vysledek.documents.push({
      name: volba.jmeno,
      body: JSON.stringify({
        ...doklad,
        _marker: kind.marker,
        ...(firma ? { _instance: firma } : {}),
        ...(kind.podtyp ? { _subtype: kind.podtyp } : {}),
      }),
      id: r.ID!,
      datum: kind.zmeny && opts.datumTahu ? opts.datumTahu : (r.DatumVystaveni ?? '').slice(0, 10),
      klic: klicRadku(r),
    });
  }

  vysledek.odlozeno = Math.max(0, nove.length - opts.maxNew);
  if (nove.length > opts.maxNew) {
    logger.warn({ agenda: agenda.key, fresh: nove.length, maxNew: opts.maxNew },
      'money-driver: nových dokladů je víc než strop běhu — zbytek přijde příště, NENÍ ztracen');
  }
  return vysledek;
}

/**
 * Celý tah přes agendy a druhy dokladů. Výpůjčka tunelu se drží po CELÝ běh
 * a vrací se i při výjimce — jinak zůstane VPN otevřená do cizí sítě.
 *
 * Pořadí: DRUH po druhu (v pořadí deklarace), uvnitř agendy. Malý živý druh (dodací
 * listy) tak projde u všech agend DŘÍV, než velké dohánění jiného druhu (faktury od
 * `changes_from`) spotřebuje čas výpůjčky a limit svc-money. Naměřeno 2026-09-24:
 * při pořadí agenda → druh spotřebovaly faktury první agendy limit a dodací listy
 * dalších agend v témže tahu vůbec nepřišly na řadu.
 */
export async function pullAll(
  client: MoneyClient,
  agendy: readonly MoneyAgenda[],
  druhy: readonly MoneyDocKind[],
  opts: MoneyPullOptions,
  logger: FastifyBaseLogger,
): Promise<MoneyAgendaResult[]> {
  const out: MoneyAgendaResult[] = [];
  const leaseId = await client.lease();
  /** Příčina, kvůli které se zbytek tahu nedotazuje (jedna, ne N kopií). */
  let preruseno: string | null = null;
  try {
    for (const k of druhy) {
      for (const a of agendy) {
        const since = opts.sinceFor ? opts.sinceFor(a.key, k.marker) : opts.since;
        const selhani = (error: string): MoneyAgendaResult => ({
          agenda: a.key, kind: k.marker, windowRows: 0, windowCapped: false,
          fresh: 0, documents: [], unreachable: false, odlozeno: 0, since, kurzor: klicKurzoru(a.key, k), error,
        });
        if (preruseno) {
          out.push(selhani(`přeskočeno — tah přerušen: ${preruseno}`));
          continue;
        }
        try {
          out.push(await pullAgenda(client, a, k, { ...opts, since }, logger));
        } catch (e) {
          const zprava = e instanceof Error ? e.message : String(e);
          out.push(selhani(zprava));
          if (e instanceof LimitSvcMoneyNecekame) preruseno = `${zprava} (u ${a.key}/${k.marker})`;
        }
      }
    }
  } finally {
    await client.release(leaseId).catch((e: unknown) => {
      logger.error({ leaseId, err: e instanceof Error ? e.message : String(e) },
        'money-driver: výpůjčku tunelu svc-money se NEPODAŘILO vrátit — tunel drží do stropu života výpůjčky');
    });
  }
  return out;
}
