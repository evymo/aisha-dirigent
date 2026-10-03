/**
 * VOLAJÍCÍ. Díl, který do 2026-08-31 chyběl a kvůli kterému stálo všechno
 * ostatní: `feedDocumentsToIngest` i `IngestClient` byly napsané a OTESTOVANÉ,
 * ale v produkci je nikdo nesestrojil — import feederu vedl JEN z jeho testu.
 * Zvenčí to vypadalo jako mrtvý zdroj dat, ne jako chybějící volání.
 *
 * Lane je VYPNUTÁ, dokud nejsou obě adresy (Money i ingest). To je tvar
 * li-driveru: schopnost je volitelná, ne rozbitá. Jakmile ale adresa je,
 * chybějící token je hlasitý pád — pověření se NEODVOZUJE.
 *
 * Co už máme, se NEstahuje znovu: rozdíl se dělá proti KURZORU doručených
 * dokladů (`MoneyKurzor`). ⛔ Do 2026-09-14 tu byla prázdná množina — tah každou
 * hodinu (při retry bouřích každou minutu) posílal tytéž doklady znovu a ingest
 * z nich udělal 6 809 kopií 51 dokladů.
 */
import type { FastifyBaseLogger } from 'fastify';
import { Client as PgClient } from 'pg';
import type { SourceBrokerConfig } from '../config.js';
import { IngestClient, IngestError, type IngestRunRow } from './ingest-client.js';
import { createMoneyClient, pullAll, klicDokladu, klicDvojice, klicKurzoru, type MoneyDocKind, type MoneyAgendaResult } from './money-driver.js';

/**
 * Druhy dokladů. DATA, ne větvení v kódu — přidat fakturu znamená přidat
 * položku, ne napsat další driver. Pole detailu odpovídají tvaru, ve kterém
 * engine korpus už má (3 822 souborů) — nový doklad tak nevypadá jinak než
 * starý, což je podmínka srovnatelné extrakce.
 */
export const DRUHY_DOKLADU: readonly MoneyDocKind[] = [
  {
    // ⛔ DO 2026-09-25 SE DODÁK TÁHL JEN JAKO NOVINKA a bez příznaku vyřízenosti.
    // Dopad byl na obrazovce: fronta předání drží běh otevřený, dokud doklad
    // neřekne „vyřízeno" — jenže tu větu jsme nikdy nestáhli. Naměřeno
    // 2026-08-31: ze 40 863 „pending" předání mělo 20 070 doklad `settled=True`
    // a SKUTEČNĚ otevřených bylo 522. Dispečink tak nabízel práci, která byla
    // v účetnictví dávno uzavřená, a první stránka byly doklady z roku 2020.
    //
    // `PriznakVyrizeno` je Boolean „Vyřízeno" — POZOR na `Vyrizeno` vedle něj,
    // to je vyřízené MNOŽSTVÍ a v hlavičce vždy 0 (dotaz projde a mlčky
    // prohlásí celý korpus za nevyřízený). Mapa `ingest/structured_maps.json`
    // z něj plní `settled`, na který se ptá ukazatel fronty.
    listEntity: 'IssuedDeliveryNotes',
    itemEntity: 'IssuedDeliveryNote',
    marker: 'money.dodaci_list',
    // ⛔ DO 2026-09-28 BYLA HLAVIČKA DODÁKU OŘEZANÁ — táž vada, jakou faktura měla
    // do 2026-09-23: bez IČO, DIČ, adresy, částek, vystavitele a stavu. Naměřeno
    // v produkci instance: VŠECH 3 151 dodáků z živého tahu (od 2026-07-31) je bez
    // IČO, tedy k protistraně se dají přiřadit jen JMÉNEM — a jméno je parametr
    // v čase (firma se přejmenuje, jméno převezme jiná). Nejčerstvější data tak
    // měla slabší identitu než historie a karta protistrany je podle IČO neviděla.
    // IČO/DIČ/adresa v HLAVIČCE jsou snímek k datu dokladu (ne dnešní adresář
    // `Firma`), tedy přesně hodnota platná v čase dokladu.
    //
    // Pole = mapa `money.dodaci_list` v instančních datech. Ověřeno DVAKRÁT:
    // dokumentace schématu `/GraphQLDoc` (IssuedDeliveryNote, skaláry) a korpus
    // stažený týmž API 2026-07-30 (20 592 dodáků, každé pole u všech; objekty
    // `Firma`/`Stredisko` dokumentace skalárů nevede, korpus je nese). ⛔ Pole
    // mimo obě sady NEPŘIDÁVAT bez sondy — neznámé pole shodí CELÝ tah dvojice.
    //
    // ⛔ `Dodano_UserData` VYŘAZENO (naměřeno 2026-09-30 na riq): živé API agendy
    // slezske-kamenolomy ho odmítá — „Cannot query field 'Dodano_UserData' on type
    // 'IssuedDeliveryNote'“ — a s ním celý detail. Od nasazení 2026-09-29 ~19:30Z
    // stál kurzor dvojice (10 dokladů × každý tah), nový dodák ani krok předání
    // nevznikl. Uživatelská pole (`*_UserData`) jsou nastavení AGENDY, ne schéma
    // Money; dokumentace ani korpus jiného dne nejsou sonda proti živé agendě.
    detailFields:
      'ID CisloDokladu CisloRady TypDokladu DatumVystaveni VariabilniSymbol ' +
      'AdresaNazev AdresaUlice AdresaPSC IC DIC Firma { Nazev } Firma_ID ' +
      'Vystavil Stredisko { Nazev } Stav PriznakVyrizeno Storno Poznamka ' +
      'SumaZaklad SumaDan SumaCelkem ' +
      'JmenoRidice_UserData RZVozidla_UserData ObchodniJmPreprav_UserData ' +
      'StaniceUrceni_UserData CisloObjednavky_UserData ' +
      'Polozky { Nazev Mnozstvi Jednotka Katalog }',
    // Dodák se po vystavení MĚNÍ (vyřídí se, stornuje se) — táhne se tedy po
    // ZMĚNÁCH, ne jen jako novinka. Bez toho by se doklad, který už jednou
    // došel, nikdy nepřetáhl a jeho vyřízení by k nám nedorazilo.
    //
    // ⛔ PODPIS ZÁMĚRNĚ BEZ `Modify_Date`, na rozdíl od faktury. Tam je to pole
    // ověřené sondou (2026-09-23); na `IssuedDeliveryNote` ho NIKDO neověřil a
    // dotaz na neexistující pole shodí CELÝ rejstřík dvojice (Status≠1), tedy
    // ne jednu vlastnost, ale celý tah dodáků. `PriznakVyrizeno` i `Storno`
    // naproti tomu z dodáků prokazatelně chodí — tahá je `dl_week.py` nad
    // `IssuedDeliveryNotes` a nese je i korpus z 2026-07-30.
    //
    // ⭐ A je to i PŘESNĚJŠÍ: u faktury se sledují úhrady, kde se mění kdeco,
    // takže tam dává smysl čas poslední změny. U dodáku je změna, na které
    // záleží, právě vyřízenost a storno — jiné úpravy hlavičky nemusí stát
    // za nové doručení. Až bude `Modify_Date` ověřené sondou, dá se přidat.
    zmeny: { podpis: ['PriznakVyrizeno', 'Storno'] },
  },
  {
    // ⛔ DO 2026-09-23 BYLA DEKLARACE NEÚPLNÁ: bez částek, IČO, firmy a stavu úhrady. Tak
    // došlo 1 014 faktur (30. 8.–18. 9.), které nevidí přehled dlužníků ani rozpad, a zapnutí
    // se proto vzalo zpět. Pole teď odpovídají `ingest/structured_maps.json` (money.faktura_vydana)
    // a exportu 2026-08-06, ze kterého je 23 728 faktur v registru; sondou ověřeno proti Money
    // 2026-09-23 (25 polí, žádné chybějící, položky s JednCena/CelkovaCena).
    listEntity: 'IssuedInvoices',
    itemEntity: 'IssuedInvoice',
    marker: 'money.faktura_vydana',
    // `Modify_Date` v DETAILU (ne jen v rejstříku): engine řadí verze téhož záznamu podle
    // `source_modified_at` (idata `structured_maps`: source_modified_at ← Modify_Date,
    // `invoice.schema` doc_version). Bez něj nemá zdrojový čas změny a sáhne po náhradním.
    detailFields:
      'ID CisloDokladu Modify_Date DatumVystaveni DatumSplatnosti DatumPlneni VariabilniSymbol ' +
      'SumaZaklad SumaDan SumaCelkem KUhrade AdresaNazev AdresaUlice AdresaPSC IC DIC ' +
      'Vystavil Stav PriznakVyrizeno UhradyZbyva Uhrady Poznamka TypDokladu Storno CisloRady ' +
      'Polozky { Nazev Mnozstvi Jednotka JednCena CelkovaCena }',
    podtyp: 'issued',
    // Jméno jako export 2026-08-06. ⛔ Ingest `/api/upload` existující soubor NEPŘEPISUJE:
    // změněný obsah uloží jako `<jméno>-N` (nový řádek registru; změřeno 2026-09-25). Verze
    // téhož záznamu proto sjednocuje ENGINE podle `doc_identity` (money_id) → supersedes,
    // ne jméno souboru.
    nazev: 'znacka-cislo-id',
    // …ale jméno, které registr pro týž `money_id` UŽ ZNÁ, má přednost (dřívější tah linky,
    // starší číslo dokladu). Naměřeno 2026-09-25: jinak 164 druhých řádků za první den.
    jmenoZRegistru: { docType: 'invoice' },
    // Faktura se mění i po vystavení (úhrady) — táhne se po ZMĚNÁCH, ne jen jako novinka.
    // `Modify_Date` (čas poslední změny v Money, ověřeno sondou 2026-09-23) dělá novou verzi
    // z JAKÉKOLI změny — i z posunuté splatnosti, která úhradu ani částku nemění. Stav úhrady
    // a částky zůstávají v podpisu jako pojistka, kdyby některá změna čas neposunula.
    zmeny: { podpis: ['Modify_Date', 'UhradyZbyva', 'SumaCelkem', 'Stav', 'Storno'] },
  },
];

export interface MoneyLaneResult {
  agendas: MoneyAgendaResult[];
  uploaded: number;
  ran: boolean;
  exported: boolean;
  /** Agendy, které MLČÍ (nevede k nim spojení) — ne prázdné. */
  unreachable: string[];
  /** Agendy, jejichž rejstřík narazil na strop — za okraj nevidíme. */
  capped: string[];
  /** Doklady jsou v ingestu a čekají, až je hlídač zpracuje; export přijde v dalším tiku. */
  cekaNaExport: boolean;
  /** Stav ingestu v okamžiku nahrání — podle něj se pozná, který běh doklady obsahuje. */
  stavIngestuPriNahrani?: { aktivni: boolean; posledniBeh: string | null };
  /** Okno tahu (datum vystavení od) — nastavené jen, když tah skutečně proběhl. */
  since?: string;
  /** Kdy tah začal (hodiny brokeru) — z něj se posouvá kurzor. */
  zacatekMs?: number;
  /** Doklady doručené do ingestu v tomto tahu — vstup kurzoru. */
  dorucene?: Array<{ klic: string; datum: string }>;
  /** Okno každé dvojice v tomto tahu (klíč kurzoru → datum) — podle něj se zapomínají doručené. */
  oknaDvojic?: Record<string, string>;
  /** Agendy vynechané, protože je správce vypnul (`inactive_agendas`). */
  vynechane?: string[];
  /** Klíče z `inactive_agendas`, které svc-money nezná — překlep nebo zaniklá agenda. */
  neznameVypnute?: string[];
}

/**
 * POLITIKA TAHU — čte se z `agent_knowledge_sources.config`, ne z prostředí.
 *
 * ⭐ Rozdělení, které tu je vědomě: TAJEMSTVÍ (VPN profil, hesla, `clientSecret`
 * agend) zůstávají v env store a administrace u nich vidí jen „nastaveno/—".
 * ROZHODNUTÍ (jak často, kolik za běh, jak daleko do minulosti, které druhy
 * dokladů) jsou data — patří do konfigurace zdroje, kterou správce mění bez
 * zásahu do nasazení. Do 2026-08-31 bylo obojí smíchané v env, takže i změna
 * intervalu znamenala redeploy.
 *
 * ⛔ CHYBĚJÍCÍ ŘÁDEK ZDROJE JE STOP, ne výchozí hodnoty. Neregistrovaný zdroj
 * nemá schválenou klasifikaci ani vlastníka; tah by pak běžel bez governance.
 */
export interface MoneyPolicy {
  intervalMs: number;
  maxNewPerRun: number;
  /** Kolik dnů zpět se dívat, když volající neurčí `since`. */
  sinceDays: number;
  /** Které druhy dokladů táhnout (značky). Prázdné = žádné. */
  markers: string[];
  /**
   * Agendy, které správce VYPNUL (klíče z `/agendas` svc-money). Chybějící klíč = žádná.
   *
   * ⛔ NAMĚŘENO 2026-09-15: agenda Areál Drutěva měla v Money neplatného API klienta
   * (`invalid_client` na svém portu i všech ostatních), dokud správce Money nevydal nové
   * client ID. Bez vypínače by lane každý tah znovu žádal o token, ve stavu by visela chyba
   * a jediná cesta k „nechat být" byla smazat pověření — tedy zahodit údaje, které po opravě
   * v Money zase platí. Vypnutí je rozhodnutí správce v konfiguraci zdroje; zapnutí týmž místem.
   * Kurzor vypnuté agendy zůstává: po zapnutí dožene, co mezitím nestáhla.
   */
  inactiveAgendas: string[];
  /**
   * Jméno FIRMY agendy (klíč agendy → jméno), jak ho nese `owner_company` v datech.
   * Chybějící klíč = štítek agendy ze svc-money. Výslovně se deklaruje tam, kde se štítek
   * od jména v datech liší — naměřeno 2026-09-23: štítek „IRISA nemovitostní, družstvo
   * IČO 24102288" × 27 faktur s „IRISA nemovitostní, družstvo". Bez deklarace by se
   * jedna firma v pohledu rozpadla na dvě.
   */
  firmyAgend: Record<string, string>;
  /**
   * Od kdy táhnout ZMĚNY druhu, dokud jeho dvojice nemá vlastní kurzor (značka → YYYY-MM-DD).
   * Deklaruje se, odkud data v registru chybí — pro faktury den posledního úplného exportu.
   * Kurzor pak dotáhne historii sám, tik po tiku (strop běhu platí), a posune se, až je úplná.
   */
  changesFrom: Record<string, string>;
}

export async function readMoneyPolicy(
  pg: PgClient,
  sourceSlug: string,
  logger: FastifyBaseLogger,
): Promise<MoneyPolicy | null> {
  const res = await pg.query<{ is_active: boolean; config: Record<string, unknown> | null }>(
    'select is_active, config from public.agent_knowledge_sources where source_slug = $1 limit 1',
    [sourceSlug],
  );
  const row = res.rows[0];
  if (!row) {
    logger.error({ sourceSlug },
      'money-lane: zdroj NENÍ registrovaný — tah se nespouští. Registrace nese klasifikaci a vlastníka; bez ní by běžel bez governance.');
    return null;
  }
  if (!row.is_active) {
    logger.warn({ sourceSlug }, 'money-lane: zdroj je registrovaný, ale NEAKTIVNÍ — aktivace je rozhodnutí člověka');
    return null;
  }
  const c = row.config ?? {};
  const cislo = (k: string, min: number): number | null => {
    const v = c[k];
    const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) && n >= min ? n : null;
  };
  const markers = Array.isArray(c.doc_markers) ? c.doc_markers.filter((m): m is string => typeof m === 'string') : [];
  // Nevyplněno = nic vypnuto. VYPLNĚNO nesmyslně (ne pole řetězců) je vada, ne „nic":
  // překlep by jinak tiše nechal agendu zapnutou, ačkoli ji správce vypínal.
  const inactiveRaw = c.inactive_agendas;
  if (inactiveRaw !== undefined && inactiveRaw !== null
      && !(Array.isArray(inactiveRaw) && inactiveRaw.every((a) => typeof a === 'string' && a.trim() !== ''))) {
    logger.error({ sourceSlug, inactive_agendas: inactiveRaw },
      'money-lane: inactive_agendas musí být pole klíčů agend — tah se nespouští');
    return null;
  }
  const inactiveAgendas = Array.isArray(inactiveRaw) ? [...new Set(inactiveRaw as string[])] : [];
  // Totéž pravidlo: nevyplněno = žádné výjimky, vyplněno nesmyslně = STOP (jinak by se
  // překlep tiše projevil jako druhé jméno téže firmy).
  const firmyRaw = c.agenda_companies;
  if (firmyRaw !== undefined && firmyRaw !== null
      && !(typeof firmyRaw === 'object' && !Array.isArray(firmyRaw)
           && Object.values(firmyRaw as Record<string, unknown>).every((v) => typeof v === 'string' && v.trim() !== ''))) {
    logger.error({ sourceSlug, agenda_companies: firmyRaw },
      'money-lane: agenda_companies musí být objekt {klíč agendy: jméno firmy} — tah se nespouští');
    return null;
  }
  const firmyAgend = firmyRaw ? Object.fromEntries(
    Object.entries(firmyRaw as Record<string, string>).map(([k, v]) => [k, v.trim()])) : {};
  const zmenyRaw = c.changes_from;
  if (zmenyRaw !== undefined && zmenyRaw !== null
      && !(typeof zmenyRaw === 'object' && !Array.isArray(zmenyRaw)
           && Object.values(zmenyRaw as Record<string, unknown>).every((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)))) {
    logger.error({ sourceSlug, changes_from: zmenyRaw },
      'money-lane: changes_from musí být objekt {značka: YYYY-MM-DD} — tah se nespouští');
    return null;
  }
  const changesFrom = (zmenyRaw ?? {}) as Record<string, string>;
  const intervalMs = cislo('pull_interval_ms', 60_000);
  const maxNew = cislo('max_new_per_run', 1);
  const sinceDays = cislo('since_days', 0);
  // ⛔ Chybějící nebo nesmyslná hodnota se NEDOSAZUJE: prázdná hodnota, která
  // se tváří jako výchozí, je přesně vada, kvůli které se tunel zavíral po
  // každém dotazu (`VPN_IDLE_MS=""` → NaN). Raději lane nespustit.
  if (intervalMs === null || maxNew === null || sinceDays === null || markers.length === 0) {
    logger.error({ sourceSlug, config: c },
      'money-lane: konfigurace zdroje je NEÚPLNÁ (pull_interval_ms, max_new_per_run, since_days, doc_markers) — tah se nespouští');
    return null;
  }
  return { intervalMs, maxNewPerRun: maxNew, sinceDays, markers, inactiveAgendas, firmyAgend, changesFrom };
}

/**
 * BĚHOVÝ STAV — `audience_broker_sync_state.metadata`, ne `config`.
 * `config` je DEKLARACE (co má platit, mění správce), stav je POZOROVÁNÍ (co
 * se stalo). Míchat je do jednoho pole znamená, že zápis stavu přepíše cizí
 * rozhodnutí — a to je přesně vada dvou zapisovatelů nad jednou hodnotou.
 */
export interface MoneyRunState {
  lastRunAt: string | null;
  lastResult: unknown;
  cekaNaExport: CekaNaExport | null;
  kurzor: MoneyKurzor | null;
}

/**
 * KURZOR — co už bylo doručeno a odkud navazovat.
 *
 * ⛔ PEVNÉ OKNO ZTRÁCELO DATA. Do 2026-09-14 bylo okno vždy „posledních since_days
 * dní od TEĎ": výpadek delší než okno (broker 09-09 … 09-13) posunul okno přes doklady,
 * které nikdo nestáhl, a ty už nepřišly nikdy.
 *
 * `od` = PRO KAŽDOU DVOJICI agenda/druh datum začátku jejího posledního ÚPLNÉHO tahu
 * (dostupná, bez chyby, nic neodloženo). Tah té dvojice se dívá od
 * `min(dnes − since_days, od − 1 den)`: běžně malé okno, po výpadku sahá přesně tam,
 * kde se naposledy skončilo.
 *
 * ⛔ PROČ PO DVOJICÍCH (naměřeno 2026-09-15, první tah): globální `od` držely tři agendy,
 * které v Money selhávají (`invalid_client`, `fetch failed`) — a s nimi i agendu, která
 * dodací listy skutečně má. Selhaná dvojice teď drží jen sebe a po zotavení dožene
 * svůj vlastní výpadek; zdravé táhnou dál malým oknem.
 * `dorucene` = klíč `agenda/druh/ID` → datum vystavení; drží se jen pro okno.
 */
export interface MoneyKurzor {
  od: Record<string, string>;
  dorucene: Record<string, string>;
}

/** Stav zapsaný dřívější verzí (`od` jako jedno datum / null) se čte jako „bez kurzoru dvojic". */
function odDvojic(k: MoneyKurzor | null | undefined): Record<string, string> {
  return k && typeof k.od === 'object' && k.od !== null ? k.od : {};
}

const DEN_MS = 86_400_000;
const datum = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Od kterého data vystavení se dvojice dívá. Čistá funkce — hodiny dodá volající. */
export function oknoOd(nyniMs: number, sinceDays: number, kurzorOd: string | null | undefined): string {
  const zPolitiky = datum(nyniMs - sinceDays * DEN_MS);
  if (!kurzorOd) return zPolitiky;
  const zKurzoru = datum(Date.parse(`${kurzorOd}T00:00:00Z`) - DEN_MS);   // den překryvu
  return zKurzoru < zPolitiky ? zKurzoru : zPolitiky;
}

/**
 * Je tah dvojice ÚPLNÝ (smí posunout kurzor)? Dostupná, bez chyby, bez pojistky rejstříku,
 * nic odloženo nad strop a nic přeskočeno uvnitř stropu. Jediné místo té podmínky.
 */
export function dvojiceUplna(a: Pick<MoneyAgendaResult, 'unreachable' | 'error' | 'windowCapped' | 'odlozeno' | 'preskoceno'>): boolean {
  return !a.unreachable && !a.error && !a.windowCapped && (a.odlozeno ?? 0) === 0 && (a.preskoceno ?? 0) === 0;
}

/**
 * Klíč kurzoru dvojice z klíče doručeného dokladu (`agenda/značka/ID` nebo `…/ID#podpis`).
 * Verze (`#`) patří kurzoru změn — viz `klicKurzoru`.
 */
export function dvojiceZKlice(klic: string): string {
  const i1 = klic.indexOf('/');
  const i2 = i1 < 0 ? -1 : klic.indexOf('/', i1 + 1);
  if (i2 < 0) return klic;
  const dvojice = klic.slice(0, i2);
  return klic.includes('#', i2) ? `${dvojice}#zmeny` : dvojice;
}

/**
 * Okno dvojice: s kurzorem navazuje na něj; bez kurzoru z politiky — a u tahu po změnách
 * nejpozději od deklarovaného `changes_from` (odkud data v registru chybí). Čistá funkce.
 */
export function oknoDvojice(
  nyniMs: number,
  sinceDays: number,
  kurzorOd: string | null | undefined,
  zmenyOdDeklarace: string | undefined,
): string {
  const okno = oknoOd(nyniMs, sinceDays, kurzorOd);
  if (kurzorOd || !zmenyOdDeklarace) return okno;
  return zmenyOdDeklarace < okno ? zmenyOdDeklarace : okno;
}

/**
 * Nový kurzor po tahu: přidá doručené, zapomene doklady starší než nejširší okno tahu
 * a posune `od` JEN dvojicím, jejichž tah byl úplný.
 */
export function posunKurzor(
  dosud: MoneyKurzor | null,
  vysledek: Pick<MoneyLaneResult, 'agendas'>,
  since: string,
  zacatekTahuMs: number,
  doruceneKlice: ReadonlyArray<{ klic: string; datum: string }>,
  oknaDvojic?: Readonly<Record<string, string>>,
): MoneyKurzor {
  // ⛔ ZAPOMÍNÁ SE PO DVOJICÍCH, ne podle nejstaršího okna tahu. Jediná dvojice, která trvale
  // selhává (naměřeno 2026-09-23: agenda s `invalid_client`), by jinak držela nejstarší okno
  // navždy a seznam doručených všech ostatních by rostl bez konce. Dvojice mimo tah (vypnutá
  // agenda) se řídí globálním `since`.
  const dorucene: Record<string, string> = {};
  for (const [k, d] of Object.entries(dosud?.dorucene ?? {})) {
    if (d >= (oknaDvojic?.[dvojiceZKlice(k)] ?? since)) dorucene[k] = d;
  }
  for (const { klic, datum: d } of doruceneKlice) dorucene[klic] = d;
  const od = { ...odDvojic(dosud) };
  for (const a of vysledek.agendas) {
    const uplna = dvojiceUplna(a);
    if (uplna) od[a.kurzor ?? klicDvojice(a.agenda, a.kind)] = datum(zacatekTahuMs);
  }
  return { od, dorucene };
}

/**
 * ČEKÁ NA EXPORT — doklady jsou v ingestu, zpracuje je jeho hlídač, export až potom.
 *
 * ⛔ PROČ NE RUN + EXPORT HNED ZA NAHRÁNÍM (tak to bylo do 2026-09-13). Plný běh ingestu
 * trvá v produkci ~9 hodin a `POST /api/run` na zámek čekal. Tahu po 120 s vypršel čas,
 * na serveru ale zůstalo vlákno ve frontě, které později spustilo celý běh — a tah to
 * po chvíli zkusil znovu. Ingest tak dojížděl stovky fantomových běhů. Zpracování
 * vstupu přitom obstarává hlídač ingestu sám; volat `run` bylo nadbytečné.
 *
 * ⭐ ROZHODUJÍ HODINY INGESTU, NE BROKERU. Při nahrání se zapíše čas posledního
 * doběhnutého běhu PODLE INGESTU a jestli zrovna nějaký běh probíhal. Probíhající běh
 * nově nahrané doklady obsahovat nemusí (vzal si vstup dřív), takže se pak čeká na DVA
 * doběhnuté běhy. V pochybnostech se tedy exportuje později, nikdy bez vlastních dokladů.
 */
export interface CekaNaExport {
  /** Kdy se poprvé nahrálo od posledního exportu (hodiny brokeru) — jen pro „jak dlouho čeká". */
  od: string;
  /** Kolik dokladů se od posledního exportu nahrálo. */
  pocet: number;
  /** Čas doběhnutí posledního běhu podle ingestu v okamžiku POSLEDNÍHO nahrání. */
  posledniBehPred: string | null;
  /** Probíhalo při posledním nahrání zpracování? */
  aktivniPriNahrani: boolean;
}

/** Smí se exportovat? Počítá se jen z údajů ingestu — dvoje hodiny se nesrovnávají. */
export function smiExportovat(
  ceka: CekaNaExport,
  aktivniTed: boolean,
  behy: readonly IngestRunRow[],
): { smi: boolean; dobehlo: number; potreba: number } {
  const potreba = ceka.aktivniPriNahrani ? 2 : 1;
  const hranice = ceka.posledniBehPred === null ? Number.NEGATIVE_INFINITY : Date.parse(ceka.posledniBehPred);
  // Nečitelný čas běhu (NaN) se nezapočítá — raději počkat než exportovat naslepo.
  const dobehlo = behy.filter((r) => typeof r.ts === 'string' && Date.parse(r.ts) > hranice).length;
  return { smi: !aktivniTed && dobehlo >= potreba, dobehlo, potreba };
}

/**
 * Jména, pod nimiž registr doklady už zná — podle `money_id` (jen čtení). Pole `money_id`
 * plní engine ze strukturované mapy (`fields.money_id.value` = ID dokladu v Money; ověřeno
 * v produkci 2026-09-25 u dřívějších i exportních jmen). Dotaz jde přes index `doc_type`,
 * změřeno 133 ms nad 25 tis. faktur.
 */
export async function jmenaVRegistru(
  pg: PgClient,
  ids: readonly string[],
  docType: string,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (ids.length === 0) return out;
  const r = await pg.query<{ mid: string; filename: string }>(
    `select fields->'money_id'->>'value' as mid, filename
       from public.li_source_registry
      where doc_type = $2 and fields->'money_id'->>'value' = any($1::text[])`,
    [ids, docType],
  );
  for (const row of r.rows) {
    if (!row.mid || !row.filename) continue;
    const seznam = out.get(row.mid) ?? [];
    if (!seznam.includes(row.filename)) seznam.push(row.filename);
    out.set(row.mid, seznam);
  }
  return out;
}

export async function readRunState(pg: PgClient, sourceSlug: string): Promise<MoneyRunState> {
  const r = await pg.query<{ last_run_at: string | null; last_result: unknown }>(
    `select metadata->>'money_last_run_at' as last_run_at,
            metadata->'money_last_result'  as last_result,
            metadata->'money_ceka_na_export' as ceka_na_export,
            metadata->'money_kurzor' as kurzor
       from public.audience_broker_sync_state where source_slug = $1`,
    [sourceSlug],
  );
  const row = r.rows[0] as { last_run_at: string | null; last_result: unknown; ceka_na_export?: CekaNaExport | null; kurzor?: MoneyKurzor | null } | undefined;
  return {
    lastRunAt: row?.last_run_at ?? null,
    lastResult: row?.last_result ?? null,
    cekaNaExport: row?.ceka_na_export ?? null,
    kurzor: row?.kurzor ?? null,
  };
}

async function zapisKurzor(pg: PgClient, sourceSlug: string, kurzor: MoneyKurzor): Promise<void> {
  await pg.query(
    `insert into public.audience_broker_sync_state (source_slug, metadata)
     values ($1, jsonb_build_object('money_kurzor', $2::jsonb))
     on conflict (source_slug) do update
       set metadata = public.audience_broker_sync_state.metadata
                      || jsonb_build_object('money_kurzor', $2::jsonb)`,
    [sourceSlug, JSON.stringify(kurzor)],
  );
}

async function zapisCekaNaExport(pg: PgClient, sourceSlug: string, ceka: CekaNaExport | null): Promise<void> {
  if (ceka === null) {
    await pg.query(
      `update public.audience_broker_sync_state
          set metadata = metadata - 'money_ceka_na_export'
        where source_slug = $1`,
      [sourceSlug],
    );
    return;
  }
  await pg.query(
    `insert into public.audience_broker_sync_state (source_slug, metadata)
     values ($1, jsonb_build_object('money_ceka_na_export', $2::jsonb))
     on conflict (source_slug) do update
       set metadata = public.audience_broker_sync_state.metadata
                      || jsonb_build_object('money_ceka_na_export', $2::jsonb)`,
    [sourceSlug, JSON.stringify(ceka)],
  );
}

async function writeRunState(pg: PgClient, sourceSlug: string, result: unknown): Promise<void> {
  await pg.query(
    `insert into public.audience_broker_sync_state (source_slug, metadata)
     values ($1, jsonb_build_object('money_last_run_at', now()::text, 'money_last_result', $2::jsonb))
     on conflict (source_slug) do update
       set metadata = public.audience_broker_sync_state.metadata
                      || jsonb_build_object('money_last_run_at', now()::text, 'money_last_result', $2::jsonb)`,
    [sourceSlug, JSON.stringify(result)],
  );
}

/** Volby jednoho tahu. `since` smí určit jen ruční tah z administrace (doplnění zpětně). */
export interface MoneyRunOptions {
  since?: string;
  known?: ReadonlySet<string>;
}

export interface MoneyLaneHandle {
  start(): void;
  stop(): void;
  /** Jeden běh na vyžádání (administrace / trigger). */
  runOnce(opts?: MoneyRunOptions): Promise<MoneyLaneResult>;
  /**
   * EVENT TRIGGER — „vznikl doklad, aktualizuj". Nespouští tah synchronně: označí ho
   * a nejbližší tik (≤ 1 min) ho provede bez ohledu na interval. Víc požadavků mezi
   * tiky splyne v jeden tah; odklad po selhání a zákaz souběhu platí dál — trigger
   * nesmí ze zdroje udělat terč.
   */
  pozadatTah(duvod: string): { prijato: true; nejpozdejiZaMs: number };
  /** Co administrace potřebuje vidět: politika, poslední běh, kdy je příště. */
  status(): Promise<{
    enabled: boolean;
    policy: MoneyPolicy | null;
    lastRunAt: string | null;
    lastResult: unknown;
    dueInMs: number | null;
    /** Odklad hodinek po selhání. `selhaniPoSobe: 0` = hodinky jedou normálně. */
    odklad: { selhaniPoSobe: number; zbyvaMs: number };
    /** Doklady v ingestu čekající na export; `null` = nic nečeká. */
    cekaNaExport: CekaNaExport | null;
    /** Kurzor doručených: odkud se navazuje a kolik dokladů okna už je doručeno. */
    kurzor: { od: Record<string, string>; doruceno: number } | null;
    /** Čekající požadavek triggeru (null = žádný). */
    pozadano: { duvod: string; kdy: string } | null;
  }>;
  enabled: boolean;
}

/** Jak často se hodinky PTAJÍ politiky. Není to interval tahu — ten je v DB. */
const TIK_MS = 60_000;

/**
 * ⛔ SELHÁVAJÍCÍ TAH NESMÍ BOMBARDOVAT CIZÍ SYSTÉM. Naměřeno 2026-09-13 v RIQ:
 * `runAndRecord` zapíše `lastRunAt` až PO úspěšném běhu, takže selhaný tah
 * hodinky zkoušely znovu při KAŽDÉM tiku. Při timeoutu ingestu (09-08 … 09-11)
 * to bylo ~480 tahů denně místo 24 — a každý z nich nejdřív celý prošel Money
 * přes VPN (`listAgendas` + `pullAll`), protože pád přišel až u doručení. Při
 * výpadku databáze (09-11 … 09-13) 1 440 pokusů denně.
 *
 * ⭐ ODKLAD SE ZDVOJNÁSOBUJE A NIKDY NEPŘESÁHNE INTERVAL Z POLITIKY. První
 * opakování za minutu — krátký výpadek se zotaví stejně rychle jako dřív — pak
 * 2, 4, 8 … minut. Strop je interval tahu: selhávající lane nikdy nečeká DÉL
 * než zdravá, jen přestane zkoušet ČASTĚJI. Při hodinovém intervalu to je
 * ~29 pokusů za den trvalého výpadku.
 *
 * ⭐ ODKLAD PLATÍ JEN PRO HODINKY. Ruční tah z administrace (`runOnce`) jde
 * mimo ně: ťuká člověk, a ten smí zkusit hned.
 */
export function odkladPoSelhani(selhaniPoSobe: number, stropMs: number): number {
  if (selhaniPoSobe <= 0) return 0;
  const odklad = TIK_MS * 2 ** Math.min(selhaniPoSobe - 1, 30);
  return Math.min(odklad, stropMs);
}

/**
 * Strop odkladu, dokud politika nebyla přečtena ani jednou (typicky start
 * služby během výpadku databáze). NENÍ to výchozí interval tahu — bez politiky
 * tah neběží vůbec. Je to jen horní mez toho, jak dlouho hodinky počkají, než
 * se na politiku zeptají znovu.
 */
const ODKLAD_STROP_BEZ_POLITIKY_MS = 60 * 60_000;

/** Slug zdroje, pod kterým je Money registrované a schválené. */
export const MONEY_SOURCE_SLUG = 'money';

export function createMoneyLane(
  config: SourceBrokerConfig,
  logger: FastifyBaseLogger,
): MoneyLaneHandle {
  const enabled = !!(config.moneyApiUrl && config.ingestApiUrl);
  let timer: NodeJS.Timeout | null = null;
  let inflight = false;
  // Odklad po selhání drží paměť, stejně jako circuit breaker ve scheduler.ts.
  // Restart služby ho vynuluje — to je v pořádku, první pokus po restartu má smysl.
  let selhaniPoSobe = 0;
  let dalsiPokusOd = 0;
  let posledniIntervalMs: number | null = null;
  let pozadano: { duvod: string; kdy: string } | null = null;

  /** Vlastní spojení, tvarem jako li-driver: pád lane nesahá na jiné pruhy. */
  async function spojeni(): Promise<PgClient> {
    const pg = new PgClient({
      connectionString: config.postgresUrl,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 60_000,
      query_timeout: 60_000,
    });
    await pg.connect();
    return pg;
  }
  // Politika se čte při KAŽDÉM běhu, ne jednou při startu: změna intervalu
  // v administraci se tak projeví bez restartu služby.

  async function runOnce(opts: MoneyRunOptions = {}): Promise<MoneyLaneResult> {
    const vysledek: MoneyLaneResult = { agendas: [], uploaded: 0, ran: false, exported: false, unreachable: [], capped: [], cekaNaExport: false };
    if (!enabled) return vysledek;

    const zacatekMs = Date.now();
    const pg = await spojeni();
    let politika: MoneyPolicy | null;
    let kurzor: MoneyKurzor | null;
    try {
      politika = await readMoneyPolicy(pg, MONEY_SOURCE_SLUG, logger);
      kurzor = (await readRunState(pg, MONEY_SOURCE_SLUG)).kurzor;
    } finally {
      await pg.end().catch(() => undefined);
    }
    if (!politika) return vysledek;

    const money = createMoneyClient(config.moneyApiUrl ?? '', config.moneyApiToken ?? '');
    const ingest = new IngestClient({ baseUrl: config.ingestApiUrl ?? '', token: config.ingestApiToken ?? '' });

    // Okno navazuje na kurzor: běžně malé, po výpadku sahá tam, kde se naposledy skončilo.
    // Ruční tah z administrace smí okno určit sám (doplnění zpětně).
    // Okno PO DVOJICÍCH: zdravá dvojice malé, dvojice po výpadku od svého kurzoru.
    const kurzorOd = odDvojic(kurzor);
    const sinceFor = (agenda: string, marker: string): string => {
      if (opts.since) return opts.since;
      const kind = DRUHY_DOKLADU.find((d) => d.marker === marker);
      const klic = kind ? klicKurzoru(agenda, kind) : klicDvojice(agenda, marker);
      return oknoDvojice(zacatekMs, politika.sinceDays, kurzorOd[klic],
        kind?.zmeny ? politika.changesFrom[marker] : undefined);
    };
    const known = opts.known ?? new Set<string>(Object.keys(kurzor?.dorucene ?? {}));
    vysledek.zacatekMs = zacatekMs;
    vysledek.dorucene = [];

    // Seznam agend se ČTE ZE ZDROJE, nedrží se druhá kopie v brokeru.
    const vsechnyAgendy = await money.listAgendas();
    const agendy = vsechnyAgendy.filter((a) => !politika.inactiveAgendas.includes(a.key));
    vysledek.vynechane = vsechnyAgendy.filter((a) => politika.inactiveAgendas.includes(a.key)).map((a) => a.key);
    vysledek.neznameVypnute = politika.inactiveAgendas.filter((k) => !vsechnyAgendy.some((a) => a.key === k));
    if (vysledek.neznameVypnute.length > 0) {
      logger.warn({ nezname: vysledek.neznameVypnute },
        'money-lane: inactive_agendas obsahuje klíč, který svc-money nezná — nic nevypíná');
    }
    // Druhy dokladů vybírá POLITIKA — přidat fakturu je změna konfigurace.
    const druhy = DRUHY_DOKLADU.filter((d) => politika.markers.includes(d.marker));

    // Nejširší okno tahu (z něj se zapomínají doručené). Deklarace `changes_from` se počítá
    // JEN u dvojic, které ještě nemají vlastní kurzor — jinak by pevné datum drželo seznam
    // doručených navždy od té doby a rostl by bez konce.
    const zmenyBezKurzoru = agendy.flatMap((a) => druhy
      .filter((k) => k.zmeny && !kurzorOd[klicKurzoru(a.key, k)])
      .map((k) => sinceFor(a.key, k.marker)));
    const since = opts.since ?? [...Object.values(kurzorOd).map((od) => oknoOd(zacatekMs, politika.sinceDays, od)), ...zmenyBezKurzoru]
      .reduce((nejstarsi, o) => (o < nejstarsi ? o : nejstarsi), oknoOd(zacatekMs, politika.sinceDays, null));
    vysledek.since = since;
    vysledek.oknaDvojic = Object.fromEntries(agendy.flatMap((a) => druhy
      .map((k) => [klicKurzoru(a.key, k), sinceFor(a.key, k.marker)] as const)));
    // Jméno firmy: výslovná deklarace v konfiguraci zdroje, jinak štítek agendy ze svc-money.
    const firma = (a: { key: string; label?: string }): string | null =>
      politika.firmyAgend[a.key] ?? a.label ?? null;

    // Jména v registru: vlastní krátké spojení na každý dotaz (dvojice), jen čtení.
    const jmena = async (ids: readonly string[], docType: string): Promise<ReadonlyMap<string, readonly string[]>> => {
      const pgJ = await spojeni();
      try {
        return await jmenaVRegistru(pgJ, ids, docType);
      } finally {
        await pgJ.end().catch(() => undefined);
      }
    };
    vysledek.agendas = await pullAll(money, agendy, druhy,
      { since, sinceFor, known, maxNew: politika.maxNewPerRun, firma, datumTahu: datum(zacatekMs), jmenaVRegistru: jmena }, logger);

    for (const a of vysledek.agendas) {
      if (a.unreachable) vysledek.unreachable.push(a.agenda);
      if (a.windowCapped) vysledek.capped.push(`${a.agenda}/${a.kind}`);
    }
    // ⛔ Selhaná dvojice NENÍ „žádný nový doklad". Naměřeno 2026-09-24: 11 z 12 dvojic
    // spadlo na limitu svc-money a log hlásil jen „žádný nový doklad" — chyba ležela
    // tiše ve stavu běhu. Kurzor takové dvojice stojí (viz `dvojiceUplna`), ale člověk
    // se to musí dozvědět z logu, ne dohledáváním.
    const chyby = vysledek.agendas.filter((a) => a.error)
      .map((a) => ({ dvojice: `${a.agenda}/${a.kind}`, chyba: (a.error ?? '').slice(0, 160) }));
    if (chyby.length > 0) {
      logger.error({ selhalo: chyby.length, z: vysledek.agendas.length, chyby },
        'money-lane: tah SELHAL u části dvojic — jejich kurzor stojí, doklady přijdou po nápravě');
    }

    const doklady = vysledek.agendas.flatMap((a) => a.documents);
    if (doklady.length === 0) {
      // Prázdno NENÍ úspěch, který by měl něco spouštět: běh nad prázdným
      // vstupem vydá balíček bez obsahu, tedy práci vypadající jako výsledek.
      logger.info({ since, unreachable: vysledek.unreachable, capped: vysledek.capped, selhalo: chyby.length },
        chyby.length > 0
          ? 'money-lane: nic se nedoručilo (část dvojic selhala, viz předchozí záznam) — ingest se NESPOUŠTÍ'
          : 'money-lane: žádný nový doklad — ingest se NESPOUŠTÍ');
      return vysledek;
    }

    for (const a of vysledek.agendas) {
      for (const d of a.documents) {
        await ingest.upload(d.name, new TextEncoder().encode(d.body));
        vysledek.uploaded += 1;
        if (d.id) vysledek.dorucene.push({ klic: d.klic ?? klicDokladu(a.agenda, a.kind, d.id), datum: d.datum });
      }
    }
    // ⭐ PŘIJETÍ JE ODDĚLENÉ OD ZPRACOVÁNÍ. `run` se nevolá — vstup zpracuje hlídač
    // ingestu. Stav ingestu se čte AŽ PO nahrání: kdyby hlídač mezitím začal, bere se to
    // jako „probíhal" a export počká na další běh. Viz `CekaNaExport`.
    const [prubeh, historie] = await Promise.all([ingest.progress(), ingest.runs()]);
    vysledek.cekaNaExport = true;
    vysledek.stavIngestuPriNahrani = {
      aktivni: prubeh.active === true,
      posledniBeh: historie.runs?.[0]?.ts ?? null,
    };

    logger.info({ uploaded: vysledek.uploaded, since, unreachable: vysledek.unreachable, capped: vysledek.capped,
      ingestZpracovava: vysledek.stavIngestuPriNahrani.aktivni },
      'money-lane: doklady doručeny do ingestu — zpracuje je hlídač, export až po doběhnutí běhu');
    return vysledek;
  }

  // Poslední rozhodnutí o exportu — loguje se jen ZMĚNA, ne každý tik devítihodinového čekání.
  let posledniCekani = '';

  /** Druhá polovina tahu: export, až ingest doklady zpracoval. Sahá JEN na ingest, ne na Money. */
  async function dokonciExport(ceka: CekaNaExport): Promise<'vyexportovano' | 'ceka'> {
    const ingest = new IngestClient({ baseUrl: config.ingestApiUrl ?? '', token: config.ingestApiToken ?? '' });
    const [prubeh, historie] = await Promise.all([ingest.progress(), ingest.runs()]);
    const aktivniTed = prubeh.active === true;
    const r = smiExportovat(ceka, aktivniTed, historie.runs ?? []);
    if (!r.smi) {
      const klic = `${aktivniTed}-${r.dobehlo}-${r.potreba}`;
      if (klic !== posledniCekani) {
        posledniCekani = klic;
        logger.info({ ...r, ingestZpracovava: aktivniTed, pocet: ceka.pocet, od: ceka.od },
          'money-lane: export čeká — ingest doklady ještě nezpracoval');
      }
      return 'ceka';
    }
    try {
      await ingest.export(`money: ${ceka.pocet} dokladů od ${ceka.od}`);
    } catch (e) {
      // 409 = ingest mezi dotazem a exportem začal zpracovávat. Není to selhání, jen „příště".
      if (e instanceof IngestError && e.kind === 'busy') {
        logger.info({ pocet: ceka.pocet }, 'money-lane: export čeká — ingest mezitím začal zpracovávat (409)');
        return 'ceka';
      }
      throw e;
    }
    const pg = await spojeni();
    try {
      await zapisCekaNaExport(pg, MONEY_SOURCE_SLUG, null);
    } finally {
      await pg.end().catch(() => undefined);
    }
    posledniCekani = '';
    logger.info({ pocet: ceka.pocet, od: ceka.od }, 'money-lane: balíček vyexportován');
    return 'vyexportovano';
  }

  /** Běh + zápis stavu. Stav se píše i u prázdného tahu — „nic nového" je
   *  taky pozorování a administrace ho musí odlišit od „neběželo". */
  async function runAndRecord(opts: MoneyRunOptions = {}): Promise<MoneyLaneResult> {
    const r = await runOnce(opts);
    const pg = await spojeni();
    try {
      // Kurzor jen po tahu, který skutečně proběhl (neaktivní zdroj nemá okno).
      if (r.since && r.zacatekMs !== undefined) {
        const dosud = (await readRunState(pg, MONEY_SOURCE_SLUG)).kurzor;
        await zapisKurzor(pg, MONEY_SOURCE_SLUG, posunKurzor(dosud, r, r.since, r.zacatekMs, r.dorucene ?? [], r.oknaDvojic));
      }
      if (r.cekaNaExport && r.stavIngestuPriNahrani) {
        const dosud = (await readRunState(pg, MONEY_SOURCE_SLUG)).cekaNaExport;
        await zapisCekaNaExport(pg, MONEY_SOURCE_SLUG, {
          od: dosud?.od ?? new Date().toISOString(),
          pocet: (dosud?.pocet ?? 0) + r.uploaded,
          // Nejnovější nahrání je nejpřísnější podmínka — běh, který ji splní, splní i starší.
          posledniBehPred: r.stavIngestuPriNahrani.posledniBeh,
          aktivniPriNahrani: r.stavIngestuPriNahrani.aktivni,
        });
      }
      await writeRunState(pg, MONEY_SOURCE_SLUG, {
        uploaded: r.uploaded, exported: r.exported, since: r.since ?? null,
        unreachable: r.unreachable, capped: r.capped,
        agendas: r.agendas.map((a) => ({ agenda: a.agenda, kind: a.kind, windowRows: a.windowRows, fresh: a.fresh,
          odlozeno: a.odlozeno ?? 0, unreachable: a.unreachable, error: a.error ?? null })),
      });
    } finally {
      await pg.end().catch(() => undefined);
    }
    return r;
  }

  return {
    enabled,
    start() {
      if (!enabled) {
        logger.info('money-lane: neplánuje se — chybí adresa Money nebo ingestu');
        return;
      }
      // ⭐ O INTERVALU ROZHODUJE DATABÁZE, ne prostředí. Hodinky tikají na
      // pevné krátké kadenci a při každém tiku se ptají POLITIKY, jestli je
      // čas. Kdyby interval držel `setInterval` z env, jeho změna v
      // administraci by se projevila až po nasazení — a to je přesně to, co
      // tahle vrstva odstraňuje. Zdroj navíc smí být neaktivní: pak politika
      // vrátí null a neběží NIC, i když hodinky tikají dál.
      timer = setInterval(() => {
        // Souběh se NEPOUŠTÍ: dlouhý tah by se překryl s dalším tikem a otevřel
        // druhou výpůjčku tunelu do cizí sítě.
        if (inflight) return;
        // ⭐ ODKLAD SE KONTROLUJE DŘÍV NEŽ JAKÉKOLI SPOJENÍ — během něj hodinky
        // nesahají ani na databázi, ani na Money.
        if (Date.now() < dalsiPokusOd) return;
        inflight = true;
        void (async () => {
          const pg = await spojeni();
          let politika: MoneyPolicy | null = null;
          let lastRunAt: string | null = null;
          let ceka: CekaNaExport | null = null;
          try {
            politika = await readMoneyPolicy(pg, MONEY_SOURCE_SLUG, logger);
            const stav = await readRunState(pg, MONEY_SOURCE_SLUG);
            lastRunAt = stav.lastRunAt;
            ceka = stav.cekaNaExport;
          } finally {
            await pg.end().catch(() => undefined);
          }
          if (!politika) return; // neaktivní/neregistrovaný zdroj — už zalogováno
          posledniIntervalMs = politika.intervalMs;
          // Export se zkouší při každém tiku — jsou to dva levné GETy na ingest, na Money
          // se nesahá. Selhání exportu (ne 409) padá do odkladu stejně jako tah.
          if (ceka) await dokonciExport(ceka);
          if (!pozadano && lastRunAt && Date.now() - Date.parse(lastRunAt) < politika.intervalMs) return;
          if (pozadano) {
            logger.info({ ...pozadano }, 'money-lane: tah na požádání (trigger)');
            pozadano = null;
          }
          await runAndRecord();
        })()
          .then(() => { selhaniPoSobe = 0; dalsiPokusOd = 0; })
          .catch((e) => {
            selhaniPoSobe += 1;
            const odklad = odkladPoSelhani(selhaniPoSobe, posledniIntervalMs ?? ODKLAD_STROP_BEZ_POLITIKY_MS);
            dalsiPokusOd = Date.now() + odklad;
            // Text zprávy se NEMĚNÍ — podle „tik selhal" se lane měří v logu.
            logger.error({ err: e instanceof Error ? e.message : String(e), selhaniPoSobe, dalsiPokusZaMs: odklad },
              'money-lane: tik selhal');
          })
          .finally(() => { inflight = false; });
      }, TIK_MS);
      logger.info({ tikMs: TIK_MS, druhy: DRUHY_DOKLADU.length },
        'money-lane: hodinky běží — interval i aktivace se čtou z konfigurace zdroje při každém tiku');
    },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
    runOnce: runAndRecord,
    pozadatTah(duvod: string) {
      // Víc požadavků mezi tiky splyne; zachová se první (nejstarší) čas.
      pozadano = { duvod: duvod.slice(0, 200), kdy: pozadano?.kdy ?? new Date().toISOString() };
      return { prijato: true as const, nejpozdejiZaMs: Math.max(TIK_MS, dalsiPokusOd - Date.now()) };
    },
    async status() {
      const pg = await spojeni();
      try {
        const policy = await readMoneyPolicy(pg, MONEY_SOURCE_SLUG, logger);
        const stav = await readRunState(pg, MONEY_SOURCE_SLUG);
        const dueInMs = policy && stav.lastRunAt
          ? Math.max(0, policy.intervalMs - (Date.now() - Date.parse(stav.lastRunAt)))
          : policy ? 0 : null;
        const zbyvaMs = Math.max(0, dalsiPokusOd - Date.now());
        return {
          enabled, policy, lastRunAt: stav.lastRunAt, lastResult: stav.lastResult,
          dueInMs: dueInMs === null ? null : Math.max(dueInMs, zbyvaMs),
          odklad: { selhaniPoSobe, zbyvaMs },
          cekaNaExport: stav.cekaNaExport,
          kurzor: stav.kurzor ? { od: odDvojic(stav.kurzor), doruceno: Object.keys(stav.kurzor.dorucene ?? {}).length } : null,
          pozadano,
        };
      } finally {
        await pg.end().catch(() => undefined);
      }
    },
  };
}
