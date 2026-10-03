/**
 * Hlášení tabletu — co Kiosk Admin na tabletu opravdu má a jak dopadlo
 * poslední rozdávání. Z nich administrace skládá přehled zařízení.
 *
 * ⭐ ZADÁNÍ MAJITELE (2026-09-28): „chceme v administraci přehled
 * instalovaných zařízení i s informací o stavu instalace.“ Server do té doby
 * věděl jen, co NABÍZÍ; jestli se to na tablet dostalo, bylo vidět jen
 * v servisním režimu u tabletu — a 27. 9. se tak nepoznalo, že tablety
 * stahovaly Řidiče 2–5× a instalace se ztrácela.
 *
 * ⛔ HLÁŠENÍ NENÍ IDENTITA. Posílá ho Kiosk Admin bez přihlášení (trasa leží za
 *    dveřmi, stejně jako seznam appek); `zarizeni` je náhodné id instalace,
 *    ne průkaz. Přehled je proto INFORMACE pro správce, ne podklad pro práva —
 *    identita tabletu a schválení jsou F1 (průkaz zařízení, relace).
 *
 * ⛔ NIC OSOBNÍHO A ŽÁDNÁ TAJEMSTVÍ. Tělo nese jen model, verzi Androidu,
 *    verze balíčků a stav rozdávání. Cokoli navíc je vada a tělo se odmítne
 *    celé (stejně jako u žádostí o nastavení).
 */

export interface HlaseniTabletu {
  zarizeni: string;
  model: string;
  android: string;
  kioskAdmin: { versionName: string; versionCode: number };
  appky: { balicek: string; versionCode: number }[];
  /** Poskytovatel WebView a verze (přihlášení Řidiče), `null` = žádný. */
  webview: string | null;
  rezim: 'kiosk' | 'servis';
  stav: string;
}

export interface UlozeneHlaseni extends HlaseniTabletu {
  /** Kdy server hlášení přijal (čas serveru, ne tabletu). */
  prijato: string;
  /** Kdy se tablet ohlásil poprvé. */
  prvni: string;
}

export const PREFIX_HLASENI = 'hlaseni/';
/** Strop na počet zařízení: hlášení je bez přihlášení, tak ať se nedá zaplavit. */
export const MAX_ZARIZENI = 500;
export const MAX_TELO_BAJTU = 4096;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Segment jména balíčku; jméno se kontroluje po segmentech (bez vnořeného kvantifikátoru). */
const SEGMENT = /^[a-zA-Z0-9_]+$/;
const MAX_APPEK = 10;

export class VadneHlaseni extends Error {}

function jeObjekt(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function jenKlice(o: Record<string, unknown>, povolene: readonly string[], kde: string): void {
  for (const k of Object.keys(o)) {
    if (!povolene.includes(k)) throw new VadneHlaseni(`${kde}: nepovolený klíč „${k}"`);
  }
}

function text(v: unknown, kde: string, max: number): string {
  if (typeof v !== 'string') throw new VadneHlaseni(`${kde}: musí být text`);
  if (v.length > max) throw new VadneHlaseni(`${kde}: nejvýš ${max} znaků`);
  // Řídicí znaky do přehledu nepatří (a v administraci by rozbily řádek).
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) throw new VadneHlaseni(`${kde}: řídicí znaky`);
  }
  return v;
}

function verze(v: unknown, kde: string): number {
  // -1 = balíček na tabletu není.
  if (!Number.isInteger(v) || (v as number) < -1 || (v as number) > 2_147_483_647) {
    throw new VadneHlaseni(`${kde}: versionCode musí být celé číslo ≥ -1`);
  }
  return v as number;
}

function balicek(v: unknown, kde: string): string {
  const b = text(v, kde, 100);
  const casti = b.split('.');
  if (casti.length < 2 || !/^[a-zA-Z]/.test(casti[0]) || !casti.every((c) => SEGMENT.test(c))) {
    throw new VadneHlaseni(`${kde}: není jméno balíčku`);
  }
  return b;
}

/** Ověří hlášení od tabletu. Cokoli navíc je vada, ne šum k zahození. */
export function prectiHlaseni(telo: unknown): HlaseniTabletu {
  if (!jeObjekt(telo)) throw new VadneHlaseni('tělo musí být objekt');
  jenKlice(telo, ['zarizeni', 'model', 'android', 'kioskAdmin', 'appky', 'webview', 'rezim', 'stav'], 'hlášení');
  const zarizeni = text(telo.zarizeni, 'zarizeni', 36).toLowerCase();
  if (!UUID.test(zarizeni)) throw new VadneHlaseni('zarizeni: musí být uuid');
  const ka = telo.kioskAdmin;
  if (!jeObjekt(ka)) throw new VadneHlaseni('kioskAdmin: musí být objekt');
  jenKlice(ka, ['versionName', 'versionCode'], 'kioskAdmin');
  if (!Array.isArray(telo.appky)) throw new VadneHlaseni('appky: musí být seznam');
  if (telo.appky.length > MAX_APPEK) throw new VadneHlaseni(`appky: nejvýš ${MAX_APPEK}`);
  const appky = telo.appky.map((a, i) => {
    if (!jeObjekt(a)) throw new VadneHlaseni(`appky[${i}]: musí být objekt`);
    jenKlice(a, ['balicek', 'versionCode'], `appky[${i}]`);
    return { balicek: balicek(a.balicek, `appky[${i}].balicek`), versionCode: verze(a.versionCode, `appky[${i}]`) };
  });
  const rezim = telo.rezim;
  if (rezim !== 'kiosk' && rezim !== 'servis') throw new VadneHlaseni('rezim: kiosk | servis');
  return {
    zarizeni,
    model: text(telo.model, 'model', 80),
    android: text(telo.android, 'android', 20),
    kioskAdmin: { versionName: text(ka.versionName, 'kioskAdmin.versionName', 40), versionCode: verze(ka.versionCode, 'kioskAdmin') },
    appky,
    webview: telo.webview === null ? null : text(telo.webview, 'webview', 120),
    rezim,
    stav: text(telo.stav, 'stav', 300),
  };
}

export function klicHlaseni(zarizeni: string): string {
  return `${PREFIX_HLASENI}${zarizeni}.json`;
}

/** Nové hlášení nad předchozím: čas přijetí je serveru, „poprvé" se drží. */
export function ulozitelne(h: HlaseniTabletu, predchozi: UlozeneHlaseni | null, ted: Date): UlozeneHlaseni {
  const prijato = ted.toISOString();
  return { ...h, prijato, prvni: predchozi?.prvni ?? prijato };
}
