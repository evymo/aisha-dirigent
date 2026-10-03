/**
 * Čisté jádro executoru akcí po události (F3a) — BEZ DB a bez sítě, testované samostatně.
 *
 * Pravidlo (`ai_proactive_trigger_definitions`) je DATA instance: kanál, příjemce, texty
 * a rozvrh leží v `action_config`. Tady se z pravidla a zabraného běhu spočítá PLÁN;
 * provedení (HTTP, zápis výsledku) dělá `executor.ts`. Díky tomu jde každé rozhodnutí
 * — kdo dostane co, co je chyba konfigurace a co jen chybějící příjemce — ověřit bez
 * databáze i bez svc-push.
 *
 * ⛔ Kanály, které executor NEZNÁ, nezabírá vůbec (claim_* je filtruje): `in_app` ze seedu
 * platformy i AI akce svc-ai-chat zůstanou netknuté. Výčet musí sedět s CHECK
 * `ai_proactive_defs_executor_principal_check` (hlídá brána proaktivni-executor-kontrakt).
 */

/** Kanály, které executor v event-workeru vykonává. Parita s SQL CHECK hlídá brána. */
export const KANALY_EXECUTORU = ['extranet', 'push', 'email'] as const;
export type Kanal = (typeof KANALY_EXECUTORU)[number];

export interface ZabranyBeh {
  run: {
    id: string;
    user_id: string;
    source_record_id: string | null;
    source_data: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  };
  definition: {
    id: string;
    name: string;
    action_type: string;
    source_table: string;
    source_event: string;
    action_config: Record<string, unknown>;
  };
}

/** Co executor umí doručit právě teď (podle nasazení, ne podle pravidla). */
export interface Schopnosti {
  /** svc-push je dosažitelný (PUSH_SERVICE_URL + servisní token). */
  push: boolean;
  /** Pošta (F3b). Do té doby vždy false → pravidlo s kanálem email končí `no_transport`. */
  email: boolean;
}

export type Plan =
  | { druh: 'extranet'; odkaz: string }
  | {
      druh: 'push';
      prijemci: string[];
      titulek: string;
      text: string;
      odkaz: string | null;
      kategorie: string;
    }
  /** Vědomě neprovedeno (např. příjemce v datech chybí) — `skipped`, ne porucha. */
  | { druh: 'preskocit'; duvod: string }
  /** Nejde provést (konfigurace pravidla, chybějící transport) — `failed`. */
  | { druh: 'selhat'; duvod: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZASTUPCE = /\{([a-z_][a-z0-9_]*)\}/gi;
const MAX_TITULEK = 120;
const MAX_TEXT = 500;

function jeKanal(x: unknown): x is Kanal {
  return typeof x === 'string' && (KANALY_EXECUTORU as readonly string[]).includes(x);
}

/**
 * Hodnoty pro šablony: jen SKALÁRY zdrojového řádku (+ pár identifikátorů běhu).
 * Vnořené objekty a pole se do textu nedostanou — šablona nesmí vynést víc, než
 * pravidlo jmenovitě chce, a rozhodně ne celý řádek.
 */
export function kontextSablony(beh: ZabranyBeh): Record<string, string> {
  const k: Record<string, string> = {};
  for (const [klic, hodnota] of Object.entries(beh.run.source_data ?? {})) {
    if (typeof hodnota === 'string' || typeof hodnota === 'number' || typeof hodnota === 'boolean') {
      k[klic] = String(hodnota);
    }
  }
  k['run_id'] = beh.run.id;
  k['definition_name'] = beh.definition.name;
  if (beh.run.source_record_id) k['source_record_id'] = beh.run.source_record_id;
  const slot = beh.run.metadata?.['cron_slot'];
  if (typeof slot === 'string') k['cron_slot'] = slot;
  return k;
}

/**
 * `{pole}` → hodnota z kontextu. Chybějící pole se NEdoplní prázdnem potichu —
 * vrátí se jejich seznam a volající rozhodne (odkaz bez id je rozbitý odkaz).
 */
export function vyplnSablonu(
  sablona: string,
  kontext: Record<string, string>,
): { text: string; chybi: string[] } {
  const chybi: string[] = [];
  const text = sablona.replace(ZASTUPCE, (_, pole: string) => {
    const v = kontext[pole];
    if (v === undefined) {
      chybi.push(pole);
      return '';
    }
    return v;
  });
  return { text, chybi: [...new Set(chybi)] };
}

function oriz(text: string, max: number): string {
  // Řídicí znaky ven (notifikace není místo pro NUL ani escape sekvence); tab a konce
  // řádků zůstávají. Filtr podle kódu znaku, ne regex s řídicími znaky (no-control-regex).
  const cisty = Array.from(text)
    .filter((z) => {
      const k = z.codePointAt(0) ?? 0;
      return k === 9 || k === 10 || k === 13 || (k >= 32 && k !== 127);
    })
    .join('')
    .trim();
  return cisty.length <= max ? cisty : `${cisty.slice(0, max - 1)}…`;
}

/** Odkaz smí být relativní cesta v aplikaci, nebo http(s). Nic jiného (javascript:, data:…). */
export function bezpecnyOdkaz(odkaz: string): boolean {
  if (odkaz.startsWith('/') && !odkaz.startsWith('//')) return true;
  try {
    const u = new URL(odkaz);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function vyresPrijemce(beh: ZabranyBeh, spec: unknown): string[] | null {
  if (spec === undefined || spec === 'run_user') return [beh.run.user_id];
  if (spec && typeof spec === 'object' && typeof (spec as { field?: unknown }).field === 'string') {
    const v = (beh.run.source_data ?? {})[(spec as { field: string }).field];
    return typeof v === 'string' && UUID.test(v) ? [v] : [];
  }
  return null; // neznámý tvar = chyba konfigurace, ne prázdný příjemce
}

/** Z pravidla a zabraného běhu spočítá, co udělat. Nikdy nevyhazuje. */
export function naplanuj(beh: ZabranyBeh, schopnosti: Schopnosti): Plan {
  const cfg = beh.definition.action_config ?? {};
  const kanal = cfg['channel'];
  if (!jeKanal(kanal)) {
    return { druh: 'selhat', duvod: `config: kanál ${JSON.stringify(kanal)} executor nezná` };
  }
  const kontext = kontextSablony(beh);

  if (kanal === 'email') {
    // Pošta je F3b (rozhodnutí majitele o úložišti pověření). Do té doby poctivě:
    // žádný transport = selhání se jménem, ne tichý úspěch a ne věčné `pending`.
    return schopnosti.email
      ? { druh: 'selhat', duvod: 'config: kanál email zatím nemá odesílač' }
      : { druh: 'selhat', duvod: 'no_transport' };
  }

  // Odkaz: u extranetu povinný (to je celá akce), u push volitelný.
  let odkaz: string | null = null;
  if (typeof cfg['link'] === 'string' && cfg['link'].length > 0) {
    const { text, chybi } = vyplnSablonu(cfg['link'], kontext);
    if (chybi.length > 0) return { druh: 'selhat', duvod: `data: odkaz potřebuje ${chybi.join(', ')}` };
    if (!bezpecnyOdkaz(text)) return { druh: 'selhat', duvod: 'config: odkaz není relativní ani http(s)' };
    odkaz = text;
  }

  if (kanal === 'extranet') {
    return odkaz === null
      ? { druh: 'selhat', duvod: 'config: kanál extranet potřebuje action_config.link' }
      : { druh: 'extranet', odkaz };
  }

  // push
  if (!schopnosti.push) return { druh: 'selhat', duvod: 'no_transport' };
  if (typeof cfg['title'] !== 'string' || cfg['title'].trim() === '') {
    return { druh: 'selhat', duvod: 'config: kanál push potřebuje action_config.title' };
  }
  const prijemci = vyresPrijemce(beh, cfg['recipient']);
  if (prijemci === null) return { druh: 'selhat', duvod: 'config: action_config.recipient má neznámý tvar' };
  if (prijemci.length === 0) return { druh: 'preskocit', duvod: 'no_recipient' };

  const titulek = vyplnSablonu(cfg['title'], kontext);
  const text = vyplnSablonu(typeof cfg['body'] === 'string' ? cfg['body'] : '', kontext);
  const chybi = [...new Set([...titulek.chybi, ...text.chybi])];
  if (chybi.length > 0) return { druh: 'selhat', duvod: `data: text potřebuje ${chybi.join(', ')}` };

  return {
    druh: 'push',
    prijemci,
    titulek: oriz(titulek.text, MAX_TITULEK),
    text: oriz(text.text, MAX_TEXT),
    odkaz,
    kategorie: `proaktivni:${beh.definition.name}`,
  };
}

// ── Rozvrh CRON pravidel ─────────────────────────────────────────────────────

/**
 * `action_config.schedule`:
 *   { "every_minutes": N }            — sloty zarovnané na N minut od epochy (UTC)
 *   { "daily_at": "HH:MM", "tz": "…" } — jednou denně v místním čase (výchozí UTC)
 * Vrací POSLEDNÍ splatný slot ≤ `ted`, nebo null (rozvrh chybí / je neplatný).
 * Zmeškané starší sloty se nedohánějí — po výpadku přijde jen ten poslední, ne lavina.
 */
export function posledniSlot(rozvrh: unknown, ted: Date): Date | null {
  if (!rozvrh || typeof rozvrh !== 'object') return null;
  const r = rozvrh as Record<string, unknown>;

  if (r['every_minutes'] !== undefined) {
    const n = r['every_minutes'];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 10_080) return null;
    const krok = n * 60_000;
    return new Date(Math.floor(ted.getTime() / krok) * krok);
  }

  if (r['daily_at'] !== undefined) {
    const m = typeof r['daily_at'] === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(r['daily_at']) : null;
    const tz = r['tz'] === undefined ? 'UTC' : r['tz'];
    if (!m || typeof tz !== 'string' || !platnePasmo(tz)) return null;
    const [hh, mm] = [Number(m[1]), Number(m[2])];
    const dnes = mistniDatum(ted, tz);
    let slot = okamzikMistnihoCasu(dnes.rok, dnes.mesic, dnes.den, hh, mm, tz);
    if (slot.getTime() > ted.getTime()) {
      const vcera = mistniDatum(new Date(slot.getTime() - 24 * 3_600_000), tz);
      slot = okamzikMistnihoCasu(vcera.rok, vcera.mesic, vcera.den, hh, mm, tz);
    }
    return slot;
  }
  return null;
}

function platnePasmo(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function mistniDatum(d: Date, tz: string): { rok: number; mesic: number; den: number } {
  const casti = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const v = (t: string) => Number(casti.find((p) => p.type === t)?.value);
  return { rok: v('year'), mesic: v('month'), den: v('day') };
}

/** Posun pásma v ms v daném okamžiku (místní − UTC). */
function posunPasma(d: Date, tz: string): number {
  const casti = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d);
  const v = (t: string) => Number(casti.find((p) => p.type === t)?.value);
  const jakoUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
  return jakoUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** Okamžik, kdy je v pásmu `tz` místní čas rok-měsíc-den hh:mm (DST: druhý průchod opraví posun). */
function okamzikMistnihoCasu(rok: number, mesic: number, den: number, hh: number, mm: number, tz: string): Date {
  const odhad = Date.UTC(rok, mesic - 1, den, hh, mm);
  let t = odhad - posunPasma(new Date(odhad), tz);
  t = odhad - posunPasma(new Date(t), tz);
  return new Date(t);
}
