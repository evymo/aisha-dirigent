/**
 * Členství sítí lane (O-2, rozhodnuto 5. 10.: „bez klíče B se z `<B>-lane` nic
 * neobslouží“ + hlídač členství). VB ho jen ČTE a vynucuje.
 *
 * Proč: projekt forku v Coolify nasadí na uzel libovolný compose, takže může připojit
 * kontejner do cizí `<B>-lane`. Bez klíče B nic nedostane, ale s NET_RAW by na mostu
 * mohl odposlechnout klíč B (klient → VB je holé HTTP až do mTLS ve fázi 2). Na síti
 * jádra by obešel VB úplně a mluvil s vLLM přímo.
 *
 * Měří hlídač přes Docker API (jediný autoritativní zdroj — z jmenného prostoru VB
 * se cizí kontejner skrýt dá, např. `arp_ignore` ve vlastním netns) a zapisuje
 * `clenstvi.json` do svazku VB. Tady platí:
 *   - měření chybí, je nečitelné nebo staré         → LANE_NEDOSTUPNA všem (NEZMĚŘENO ≠ v pořádku);
 *   - měření je k JINÉ deklaraci, než má VB         → LANE_NEDOSTUPNA všem (po změně deklarace
 *     platí až nové měření — staré schválení se nepřenáší na nové nájemce ani sítě);
 *   - na síti jádra je cizí kontejner                → LANE_NEDOSTUPNA všem;
 *   - síť nájemce není v měření                      → LANE_NEDOSTUPNA tomu nájemci;
 *   - na síti nájemce je cizí kontejner              → NAJEMCE_VYPNUT tomu nájemci, i s platným
 *     klíčem (klíč mohl být odposlechnut — operátor ho rotuje); ostatní běží dál.
 * Incident hlídač DRŽÍ (i po odchodu cizího kontejneru) — viz hlidac.ts.
 * `varovani` (kontejnery s root přístupem k uzlu) VB jen hlásí: v uzlu se vynutit nedají.
 */
import { createHash } from 'node:crypto';
import { readFileSync, watch, type FSWatcher } from 'node:fs';
import { z } from 'zod';
import { JMENO_NAJEMCE } from './tabulka.js';

/** Hlídač zapisuje nejvýš po 10 s; trojnásobek pokryje jeden vynechaný zápis. */
export const MEZ_CERSTVOSTI_MS = 30_000;
/** Hodiny hlídače a VB jsou tytéž (jeden uzel); měření z budoucnosti je vada, ne „čerstvé navždy“. */
const TOLERANCE_BUDOUCNOSTI_MS = 5_000;

const SitSchema = z.object({ ok: z.boolean(), cizi: z.array(z.string().min(1).max(128)).max(64) }).strict();

export const ClenstviSchema = z
  .object({
    verze: z.literal(1),
    zmereno: z.string().datetime(),
    /** sha256 obsahu deklarace, ke které měření patří. */
    deklarace: z.string().regex(/^[0-9a-f]{64}$/),
    jadro: SitSchema,
    najemci: z.record(z.string().regex(JMENO_NAJEMCE), SitSchema),
    varovani: z.array(z.string().min(1).max(200)).max(64),
  })
  .strict();

export type ClenstviData = z.infer<typeof ClenstviSchema>;
export type StavClenstvi = ClenstviData | { necitelne: string };
export type RozhodnutiClenstvi = null | { duvod: 'LANE_NEDOSTUPNA' | 'NAJEMCE_VYPNUT'; error: string };

/** Smí nájemce `najemce` (null = jen celouzlové podmínky) dál? `null` = ano. */
export function rozhodniClenstvi(s: StavClenstvi, najemce: string | null, ted: number): RozhodnutiClenstvi {
  if ('necitelne' in s) return { duvod: 'LANE_NEDOSTUPNA', error: 'izolace sítí lane není změřená' };
  const stari = ted - Date.parse(s.zmereno);
  if (stari > MEZ_CERSTVOSTI_MS || stari < -TOLERANCE_BUDOUCNOSTI_MS) return { duvod: 'LANE_NEDOSTUPNA', error: 'měření izolace sítí lane není aktuální' };
  if (!s.jadro.ok) return { duvod: 'LANE_NEDOSTUPNA', error: 'na síti jádra je cizí kontejner' };
  if (najemce === null) return null;
  const sit = s.najemci[najemce];
  if (!sit) return { duvod: 'LANE_NEDOSTUPNA', error: 'síť nájemce není v měření izolace' };
  if (!sit.ok) return { duvod: 'NAJEMCE_VYPNUT', error: 'na síti nájemce je cizí kontejner — vypnuto do zásahu operátora' };
  return null;
}

/** Soubor měření ve svazku VB — čtení za běhu jako deklarace (watch + záložní poll). */
export class Clenstvi {
  private aktualni: StavClenstvi = { necitelne: 'měření ještě nebylo načteno' };
  private otisk = '';
  private hlaseneCizi = '';
  private hlaseneVarovani = '';

  /** `otiskDeklarace` = sha256 deklarace, kterou VB právě vynucuje ('' = žádná platná). */
  constructor(
    private readonly cesta: string,
    private readonly otiskDeklarace: () => string,
    private readonly hlaseni: (udalost: string, data: Record<string, unknown>) => void = () => {},
  ) {}

  stav(): StavClenstvi {
    const s = this.aktualni;
    if ('necitelne' in s) return s;
    const d = this.otiskDeklarace();
    return d && s.deklarace === d ? s : { necitelne: 'měření patří k jiné deklaraci, než má vstup' };
  }

  nacti(): void {
    let text: string;
    try {
      text = readFileSync(this.cesta, 'utf8');
    } catch (e) {
      return this.necitelne(`soubor nejde přečíst (${(e as NodeJS.ErrnoException).code ?? 'chyba'})`, '');
    }
    const otisk = createHash('sha256').update(text).digest('hex');
    if (otisk === this.otisk) return;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return this.necitelne('není platný JSON', otisk);
    }
    const r = ClenstviSchema.safeParse(json);
    if (!r.success) return this.necitelne(`neplatné: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, otisk);
    this.aktualni = r.data;
    this.otisk = otisk;
    // Cizí kontejner je alarm (journald → Matrix): hlásit při změně, ne při každém zápisu.
    const cizi = { jadro: r.data.jadro.cizi, najemci: Object.fromEntries(Object.entries(r.data.najemci).filter(([, s]) => !s.ok).map(([id, s]) => [id, s.cizi])) };
    const klic = JSON.stringify(cizi);
    if (klic !== this.hlaseneCizi) {
      this.hlaseneCizi = klic;
      if (cizi.jadro.length > 0 || Object.keys(cizi.najemci).length > 0) this.hlaseni('clenstvi_cizi', cizi);
      else this.hlaseni('clenstvi_v_poradku', {});
    }
    const varovani = JSON.stringify(r.data.varovani);
    if (varovani !== this.hlaseneVarovani) {
      this.hlaseneVarovani = varovani;
      if (r.data.varovani.length > 0) this.hlaseni('clenstvi_varovani', { varovani: r.data.varovani });
    }
  }

  private necitelne(duvod: string, otisk: string): void {
    const zmena = !('necitelne' in this.aktualni) || this.aktualni.necitelne !== duvod;
    this.aktualni = { necitelne: duvod };
    this.otisk = otisk;
    this.hlaseneCizi = '';
    if (zmena) this.hlaseni('clenstvi_necitelne', { duvod });
  }

  sleduj(pollMs = 2000): () => void {
    this.nacti();
    let w: FSWatcher | null = null;
    try {
      w = watch(this.cesta, () => this.nacti());
    } catch {
      w = null;
    }
    const t = setInterval(() => this.nacti(), pollMs);
    t.unref();
    return () => {
      clearInterval(t);
      w?.close();
    };
  }
}
