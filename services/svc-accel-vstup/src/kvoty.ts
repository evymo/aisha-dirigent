/**
 * Kvóty a spotřeba po nájemci (Q1–Q3, Q5, R3 jádra 0c).
 *
 * - Souběh zvlášť pro třídu `dotaz` a `davka`: přepočet (dávka) nikdy nebere sloty
 *   interaktivních dotazů téhož nájemce (R3, MN11).
 * - `gpu_ms` = obsazení enginu podle hodin od odeslání požadavku do posledního
 *   bajtu odpovědi, nebo do zavření spojení po přerušení — účtuje se i chyba a
 *   přerušení (Q5), jinak by šla kvóta obejít přerušovanými požadavky.
 * - Pevná okna `okno_s`; vyčerpané okno = KVOTA_PREKROCENA jen tomu nájemci (Q3).
 * - Režim `kvoty.rezim` z deklarace: `vynucovat` = překročení odmítne (429), `varovani` = požadavek
 *   projde a povolení nese seznam překročených kvót (vstup ho zapíše a vrátí v x-aisha-kvota).
 *   Počítá se v obou režimech stejně (souběh i spotřeba), jinak by varování lhalo o tom, kde se
 *   nájemci potkávají. Kniha bez zápisu a chybějící kvóty zůstávají tvrdé: to je účetnictví, ne mez.
 * - Kniha nedostupná = POCITADLO_NEDOSTUPNE, požadavek NEprojde nezapočtený (MJ19).
 * Kniha je v paměti: restart VB okna vynuluje (deklarováno v návrhu).
 */
import type { Duvod, Trida } from '@aisha/accel-protokol';
import type { Najemce } from './tabulka.js';

export interface Kniha {
  /** Je zápis spotřeby možný? Volá se před vstupem — bez knihy se nic nepustí. */
  dostupna(): boolean;
  zapis(najemceId: string, okno: number, ms: number): void;
  precti(najemceId: string, okno: number): number;
}

export function knihaVPameti(): Kniha {
  const m = new Map<string, number>();
  return {
    dostupna: () => true,
    zapis: (n, o, ms) => m.set(`${n}@${o}`, (m.get(`${n}@${o}`) ?? 0) + ms),
    precti: (n, o) => m.get(`${n}@${o}`) ?? 0,
  };
}

export interface Povoleni {
  /** Uvolni slot a započti spotřebu (ms obsazení enginu). Volat přesně jednou. */
  uvolni(gpuMs: number): void;
  /** Kvóty, přes které požadavek prošel v režimu `varovani` (prázdné = pod mezí). */
  prekroceno: string[];
}

export class Kvoty {
  private bezi = new Map<string, number>();

  constructor(private readonly kniha: Kniha, private readonly ted: () => number = Date.now) {}

  private okno(n: Najemce): number {
    return Math.floor(this.ted() / (n.kvoty.okno_s * 1000));
  }

  /**
   * `znovuZaS` = kdy to zkusit znovu (hlavička Retry-After): vyčerpané okno → do další hranice pevného okna
   * (nahoru, aspoň 1 s), plný souběh → 1 s. Klient tak nemusí znát zarovnání oken.
   */
  vstup(n: Najemce, trida: Trida): Povoleni | { duvod: Duvod; kvota?: string; znovuZaS?: number } {
    if (!n.kvoty) return { duvod: 'KVOTA_CHYBI' };
    if (!this.kniha.dostupna()) return { duvod: 'POCITADLO_NEDOSTUPNE' };
    let spotreba: number;
    try {
      spotreba = this.kniha.precti(n.id, this.okno(n));
    } catch {
      return { duvod: 'POCITADLO_NEDOSTUPNE' };
    }
    const vynucovat = n.kvoty.rezim === 'vynucovat';
    const prekroceno: string[] = [];
    if (spotreba >= n.kvoty.gpu_ms_za_okno) {
      const konecOkna = (this.okno(n) + 1) * n.kvoty.okno_s * 1000;
      if (vynucovat) return { duvod: 'KVOTA_PREKROCENA', kvota: 'gpu_ms_za_okno', znovuZaS: Math.max(1, Math.ceil((konecOkna - this.ted()) / 1000)) };
      prekroceno.push('gpu_ms_za_okno');
    }
    const klic = `${n.id}:${trida}`;
    const bezi = this.bezi.get(klic) ?? 0;
    if (bezi >= n.kvoty.soubeh[trida]) {
      if (vynucovat) return { duvod: 'KVOTA_PREKROCENA', kvota: `soubeh.${trida}`, znovuZaS: 1 };
      prekroceno.push(`soubeh.${trida}`);
    }
    this.bezi.set(klic, bezi + 1);
    const okno = this.okno(n);
    let hotovo = false;
    return {
      prekroceno,
      uvolni: (gpuMs: number) => {
        if (hotovo) return;
        hotovo = true;
        this.bezi.set(klic, (this.bezi.get(klic) ?? 1) - 1);
        this.kniha.zapis(n.id, okno, Math.max(0, Math.round(gpuMs)));
      },
    };
  }

  /** Agregát nájemce za aktuální okno (D3: jen vlastní). */
  agregat(n: Najemce): { rezim: 'varovani' | 'vynucovat'; okno_s: number; gpu_ms: number; gpu_ms_za_okno: number; bezi: { dotaz: number; davka: number } } {
    return {
      rezim: n.kvoty.rezim,
      okno_s: n.kvoty.okno_s,
      gpu_ms: this.kniha.precti(n.id, this.okno(n)),
      gpu_ms_za_okno: n.kvoty.gpu_ms_za_okno,
      bezi: { dotaz: this.bezi.get(`${n.id}:dotaz`) ?? 0, davka: this.bezi.get(`${n.id}:davka`) ?? 0 },
    };
  }
}
