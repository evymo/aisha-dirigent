/**
 * Roster z adresy: kdo smí zaťukat, se čte za běhu, ne jen při startu.
 *
 * ── PROČ ─────────────────────────────────────────────────────────────────────
 * `SPA_OPERATORS_B64` a `SPA_OPERATORS_FILE` se čtou při startu. To stačí, když
 * jsou operátoři dva a mění se jednou za čtvrt roku. Jakmile pověření vydává
 * a odvolává administrace protistrany po jednotlivých telefonech, znamenala by
 * každá změna restart služby — a restartem se zavřou dveře i lidem, kteří jsou
 * zrovna uvnitř.
 *
 * ── TAHÁME, NEČEKÁME NA ZAVOLÁNÍ ─────────────────────────────────────────────
 * Žádný webhook. Protistrana tak nemusí držet naše tajemství ani řešit
 * opakování při našem výpadku a my nemusíme mít veřejný zápisový endpoint.
 * Ptáme se často na levnou VERZI a stahujeme roster jen když se liší.
 *
 * ── ZPOŽDĚNÍ JE BEZPEČNÉ, A JE DŮLEŽITÉ VĚDĚT PROČ ──────────────────────────
 * Odvolané pověření přestane platit na STRANĚ BRÁNY okamžitě: brána uznává jen
 * `kid`, který má ve své politice. I kdybychom na odvolaný klíč ještě chvíli
 * otevřeli dírku, brána ji neuzná. Prodleva tedy zdržuje jen to, kdy NOVÉ
 * zařízení poprvé zaťuká. To je pohodlí, ne bezpečnost.
 *
 * ── ZÁKLAD Z PROSTŘEDÍ ZŮSTÁVÁ (2026-09-28) ──────────────────────────────────
 * Vlastní tablety si roster berou z brány (schválené v administraci). Kódy
 * techniků a break-glass ale dál žijí JEN v prostředí dveří (`SPA_OPERATORS_B64`)
 * a roster z adresy je nesmí vyměnit ani přepsat — jinak by výpadek nebo chyba
 * databáze zamkla i člověka, který to jde opravit. Proto se roster z adresy
 * SPOJUJE se základem (`spojSeZakladem`), nenahrazuje ho.
 *
 * Tady, kde dveře nikdo další nehlídá, zdržení u odvolání bezpečné NENÍ:
 * `kid`, který z rosteru z adresy zmizí, dostane dírku zavřenou hned
 * (`odvolano` → `door.closeForKid`), ne až po vypršení nájmu.
 */
import { operatorDefects, type Operator } from '@aisha/knock-protocol';

/** Odkud a jak často. */
export interface RosterZdroj {
  /** Adresa vracející HOLOU mapu `kid` → klíče. */
  url: string;
  /** Adresa vracející otisk a počet. Prázdné = stahuje se pokaždé. */
  versionUrl: string;
  /** Token do hlavičky `X-Token`. */
  token: string;
  intervalSec: number;
}

export interface Verze {
  version: string;
  count: number;
}

export type Verdikt =
  | { ok: true; operators: Record<string, Operator>; pocet: number }
  | { ok: false; duvod: string };

/**
 * Posoudí stažený roster. Čistá funkce — testuje se bez sítě.
 *
 * ⛔ ODMÍTÁ SE CELÝ ROSTER, ne jednotlivé vadné položky. Vyhodit vadný záznam
 * a zbytek přijmout zní vstřícně, ale znamená to tiše odstřihnout jednoho
 * člověka a nikomu to neříct. Odmítnutí celku nechá platit ten předchozí,
 * tedy stav, o kterém víme, že fungoval.
 *
 * ⛔ POČET SE KŘÍŽOVĚ OVĚŘUJE. Protistrana vrací PRÁZDNOU mapu i tehdy, když
 * volajícímu chybí oprávnění — na jejich straně je to správně fail-closed,
 * jenže pro nás je „nikdo nesmí zaťukat" k nerozeznání od „všem odvolali
 * pověření". Verze nese `count`, takže se ty dva stavy rozliší. Bez toho by
 * stačilo odebrat nám právo a zaťukání by přestalo fungovat bez jediné hlášky.
 */
export function posudRoster(telo: unknown, ocekavanyPocet: number | null): Verdikt {
  if (telo === null || typeof telo !== 'object' || Array.isArray(telo)) {
    return { ok: false, duvod: 'odpověď není mapa operátorů' };
  }

  const operators = telo as Record<string, Operator>;
  const kids = Object.keys(operators);

  const vady = kids.flatMap((k) => operatorDefects(k, operators[k]));
  if (vady.length > 0) {
    return { ok: false, duvod: `vadné záznamy (${vady.length}): ${vady.slice(0, 3).join('; ')}` };
  }

  if (ocekavanyPocet !== null && ocekavanyPocet !== kids.length) {
    return {
      ok: false,
      duvod:
        `verze hlásí ${ocekavanyPocet} zařízení, roster jich nese ${kids.length} — ` +
        'nejspíš nám chybí oprávnění a dostáváme oříznutý pohled',
    };
  }

  return { ok: true, operators, pocet: kids.length };
}

/** Jedno stažení. `null` = nepodařilo se; volající si nechá ten předchozí. */
async function stahni(url: string, token: string, fetchImpl: typeof fetch): Promise<unknown | null> {
  try {
    const odpoved = await fetchImpl(url, {
      headers: token ? { 'X-Token': token } : {},
      signal: AbortSignal.timeout(10_000),
    });
    if (!odpoved.ok) return null;
    return await odpoved.json();
  } catch {
    return null;
  }
}

export async function stahniVerzi(zdroj: RosterZdroj, fetchImpl: typeof fetch = fetch): Promise<Verze | null> {
  if (!zdroj.versionUrl) return null;
  const telo = await stahni(zdroj.versionUrl, zdroj.token, fetchImpl);
  if (telo === null || typeof telo !== 'object') return null;
  const v = telo as Record<string, unknown>;
  // `state:false` znamená „nemáš právo“ — ne nula zařízení.
  if (v.state === false) return null;
  if (typeof v.version !== 'string' || typeof v.count !== 'number') return null;
  return { version: v.version, count: v.count };
}

export async function stahniRoster(
  zdroj: RosterZdroj,
  ocekavanyPocet: number | null,
  fetchImpl: typeof fetch = fetch,
): Promise<Verdikt> {
  const telo = await stahni(zdroj.url, zdroj.token, fetchImpl);
  if (telo === null) return { ok: false, duvod: 'roster se nepodařilo stáhnout' };
  return posudRoster(telo, ocekavanyPocet);
}

export type Spojeni =
  | { ok: true; operators: Record<string, Operator>; odebrane: string[] }
  | { ok: false; duvod: string };

/** Porovnání záznamů bez ohledu na pořadí klíčů objektu. */
function stejnyZaznam(a: Operator, b: Operator): boolean {
  const kanon = (o: Operator) =>
    JSON.stringify(Object.keys(o).sort().map((k) => [k, (o as unknown as Record<string, unknown>)[k]]));
  return kanon(a) === kanon(b);
}

/**
 * Spojí základ z prostředí s rosterem z adresy. Čistá funkce.
 *
 * ⛔ ROSTER Z ADRESY ZÁKLAD NEPŘEPÍŠE. Tentýž `kid` s JINÝM obsahem odmítne
 * celý roster z adresy (platí dál ten předchozí) — buď chyba v datech, nebo
 * pokus vydávat se za technika; obojí se má ozvat, ne tiše vyhrát. Totožný
 * záznam (zařízení dřív vyexportované do prostředí ručně) kolize není.
 *
 * `odebrane` = kid, které byly v předchozím rosteru z adresy a v novém už
 * nejsou (a nejsou ani v základu) — odvolané; dveře je zavřou hned.
 */
/**
 * Vlastní klíč objektu. `Object.hasOwn` je ES2022 — svc-knock ho má, ale tenhle modul
 * importuje i DB test F1 v kořeni (tsconfig.app ES2020), takže rovnocenný zápis.
 */
const vlastni = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

export function spojSeZakladem(
  zaklad: Record<string, Operator>,
  zAdresy: Record<string, Operator>,
  predchoziZAdresy: Record<string, Operator>,
): Spojeni {
  const kolize = Object.keys(zAdresy).filter(
    (kid) => vlastni(zaklad, kid) && !stejnyZaznam(zaklad[kid], zAdresy[kid]),
  );
  if (kolize.length > 0) {
    return {
      ok: false,
      duvod: `roster z adresy by přepsal základ z prostředí (${kolize.length}): ${kolize.slice(0, 3).join(', ')}`,
    };
  }
  const odebrane = Object.keys(predchoziZAdresy).filter(
    (kid) => !vlastni(zAdresy, kid) && !vlastni(zaklad, kid),
  );
  return { ok: true, operators: { ...zAdresy, ...zaklad }, odebrane };
}

export interface Obnova {
  /** Zastaví smyčku. */
  stop: () => void;
  /** Máme použitelný roster? Patří do `/ready`. */
  pripraven: () => boolean;
  /** Jedno kolo — volá se i ručně při startu, aby se nečekalo na první tik. */
  kolo: () => Promise<void>;
}

/**
 * Spustí obnovovací smyčku.
 *
 * `nastav` dostane novou mapu (základ + roster z adresy) jen tehdy, když
 * projde posouzením i spojením. Při jakémkoli problému se NEVOLÁ a platí dál
 * ten předchozí roster — výpadek protistrany nesmí zavřít dveře lidem, kteří
 * už jsou uvnitř.
 */
export function spustObnovuRosteru(
  zdroj: RosterZdroj,
  deps: {
    nastav: (operators: Record<string, Operator>) => void;
    log: (udalost: Record<string, unknown>) => void;
    /** Kódy z prostředí (technici, break-glass); roster z adresy je nepřepíše. */
    zaklad?: Record<string, Operator>;
    /** `kid`, který z rosteru z adresy zmizel — dveře mu zavřou dírku hned. */
    odvolano?: (kid: string) => void;
    fetchImpl?: typeof fetch;
  },
): Obnova {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const zaklad = deps.zaklad ?? {};
  let posledniVerze: string | null = null;
  let mameRoster = false;
  let predchoziZAdresy: Record<string, Operator> = {};

  const kolo = async (): Promise<void> => {
    const verze = await stahniVerzi(zdroj, fetchImpl);

    // ⛔ CHYBĚJÍCÍ a NEDOSTUPNÁ verzní routa jsou DVA různé stavy a nesmí se
    // slít do jednoho (na tomhle mě chytil test):
    //   · není nakonfigurovaná → roster se tahá pokaždé, tak je to zamýšlené;
    //   · je nakonfigurovaná, ale neodpovídá → výpadek, necháme ten předchozí.
    // Bez téhle podmínky by druhá varianta pohltila první a při nenastavené
    // verzní routě by se roster obnovil právě jednou, při startu.
    if (zdroj.versionUrl !== '' && verze === null && mameRoster) {
      deps.log({ ev: 'roster-verze-nedostupna', pozn: 'ponechavam soucasny roster' });
      return;
    }

    if (verze !== null && verze.version === posledniVerze) return;

    const verdikt = await stahniRoster(zdroj, verze?.count ?? null, fetchImpl);
    if (!verdikt.ok) {
      deps.log({ ev: 'roster-odmitnut', duvod: verdikt.duvod, ponechano: mameRoster });
      return;
    }

    const spojeni = spojSeZakladem(zaklad, verdikt.operators, predchoziZAdresy);
    if (!spojeni.ok) {
      deps.log({ ev: 'roster-odmitnut', duvod: spojeni.duvod, ponechano: mameRoster });
      return;
    }

    deps.nastav(spojeni.operators);
    predchoziZAdresy = verdikt.operators;
    posledniVerze = verze?.version ?? null;
    mameRoster = true;
    deps.log({ ev: 'roster-obnoven', zarizeni: verdikt.pocet, verze: verze?.version ?? '(bez verze)' });
    for (const kid of spojeni.odebrane) {
      deps.log({ ev: 'roster-odvolano', kid });
      deps.odvolano?.(kid);
    }
  };

  const timer = setInterval(() => void kolo(), Math.max(5, zdroj.intervalSec) * 1000);
  // Časovač nesmí držet proces naživu sám o sobě.
  if (typeof timer.unref === 'function') timer.unref();

  return { stop: () => clearInterval(timer), pripraven: () => mameRoster, kolo };
}
