/**
 * Připravenost enginu lane (R5a jádra 0c).
 *
 * „Zdravý“ ≠ „připravený“ (naměřeno 10-05, vLLM 0.30.0): /health 200 přišlo za
 * 140 s, ale první dotaz neodpověděl ani za 60 s; s CUDA grafy trval start 271 s.
 * Engine je proto PŘIPRAVEN, až když /health odpoví 200 A vynucovací bod sám
 * dokončí zahřívací dotaz na plnou deklarovanou délku a odpověď potvrdí identitu
 * vah (EM2). Do té doby nájemce dostane hned LANE_STARTUJE, nikdy visení (MJ23).
 *
 * Rozhodnutí pro požadavek je SYNCHRONNÍ nad stavem v paměti — fork dostane
 * odpověď v milisekundách, mez 3 s je pro celou cestu (R5a). Sondy běží zvlášť.
 *
 *   VYPNUT    deklarace `zapnuto: false`                         → LANE_NEDOSTUPNA
 *   STARTUJE  /health ≠ 200 a od prvního nezdaru < start_mez_s    → LANE_STARTUJE
 *   ZAHRIVA   /health 200, zahřátí neskončilo                      → LANE_STARTUJE
 *   PRIPRAVEN zahřáto a identita sedí                              → propustit
 *   NEZDRAVY  byl připravený a /health selže, nebo start přetáhl    → LANE_NEDOSTUPNA
 *   ROZPOR    engine hlásí jinou identitu vah, než deklarace        → LANE_NEDOSTUPNA (nahlas v logu)
 */
import type { Duvod } from '@aisha/accel-protokol';
import type { Engine } from './tabulka.js';

export type StavEnginu = 'VYPNUT' | 'STARTUJE' | 'ZAHRIVA' | 'PRIPRAVEN' | 'NEZDRAVY' | 'ROZPOR';

export interface Sondy {
  /** /health enginu s limitem 1 s: true = 200. */
  zdravi(e: Engine): Promise<boolean>;
  /** Zahřívací dotaz: vrátí identitu vah, kterou engine potvrdil, nebo vyhodí chybu. */
  zahrej(e: Engine): Promise<{ format: string; sha256: string; revize: string }>;
  /** Čas v ms (injektovaný kvůli testům). */
  ted(): number;
}

interface Zaznam {
  stav: StavEnginu;
  /** Kdy začal neúspěšný start (pro start_mez_s). */
  startOd: number | null;
  zahrivani: Promise<void> | null;
  byl_pripraven: boolean;
}

export class Pripravenost {
  private zaznamy = new Map<string, Zaznam>();

  constructor(private readonly sondy: Sondy, private readonly hlaseni: (udalost: string, data: Record<string, unknown>) => void = () => {}) {}

  stav(engineId: string): StavEnginu {
    return this.zaznamy.get(engineId)?.stav ?? 'STARTUJE';
  }

  /** Synchronní rozhodnutí pro požadavek: null = propustit, jinak kód R5a. */
  rozhodni(e: Engine | undefined): Duvod | null {
    if (!e) return 'LANE_NEDOSTUPNA';
    if (!e.zapnuto) return 'LANE_NEDOSTUPNA';
    switch (this.stav(e.id)) {
      case 'PRIPRAVEN':
        return null;
      case 'STARTUJE':
      case 'ZAHRIVA':
        return 'LANE_STARTUJE';
      default:
        return 'LANE_NEDOSTUPNA';
    }
  }

  /** Jeden krok sondování všech enginů (volá se jednou za sekundu). */
  async krok(enginy: Iterable<Engine>): Promise<void> {
    await Promise.all([...enginy].map((e) => this.krokEnginu(e)));
  }

  private nastav(e: Engine, z: Zaznam, stav: StavEnginu): void {
    if (z.stav !== stav) this.hlaseni('stav_enginu', { engine: e.id, z: z.stav, na: stav });
    z.stav = stav;
  }

  private async krokEnginu(e: Engine): Promise<void> {
    let z = this.zaznamy.get(e.id);
    if (!z) {
      z = { stav: 'STARTUJE', startOd: null, zahrivani: null, byl_pripraven: false };
      this.zaznamy.set(e.id, z);
    }
    if (!e.zapnuto) {
      this.nastav(e, z, 'VYPNUT');
      z.startOd = null;
      z.byl_pripraven = false;
      return;
    }
    if (z.stav === 'ROZPOR') return; // rozpor identity se sám nespraví — nové nasazení enginu
    if (z.zahrivani) return; // zahřívání běží; výsledek nastaví stav

    const zdravy = await this.sondy.zdravi(e).catch(() => false);
    const ted = this.sondy.ted();
    if (!zdravy) {
      if (z.stav === 'PRIPRAVEN' || z.byl_pripraven) {
        // Byl připravený a teď neodpovídá: nedostupná. Po návratu /health se znovu zahřeje.
        this.nastav(e, z, 'NEZDRAVY');
        z.byl_pripraven = false;
        z.startOd = ted;
        return;
      }
      if (z.startOd === null) z.startOd = ted;
      this.nastav(e, z, ted - z.startOd > e.start_mez_s * 1000 ? 'NEZDRAVY' : z.stav === 'NEZDRAVY' ? 'NEZDRAVY' : 'STARTUJE');
      return;
    }
    if (z.stav === 'PRIPRAVEN') return;
    // /health 200 — připravenost až po vlastním zahřívacím dotazu.
    this.nastav(e, z, 'ZAHRIVA');
    z.zahrivani = this.sondy
      .zahrej(e)
      .then((id) => {
        const sedi = id.format === e.identita.format && id.sha256 === e.identita.sha256 && id.revize === e.identita.revize;
        if (!sedi) {
          this.hlaseni('rozpor_identity', { engine: e.id });
          this.nastav(e, z!, 'ROZPOR');
          return;
        }
        this.nastav(e, z!, 'PRIPRAVEN');
        z!.byl_pripraven = true;
        z!.startOd = null;
      })
      .catch((err: unknown) => {
        this.hlaseni('zahrati_selhalo', { engine: e.id, pricina: String((err as Error)?.message ?? err).slice(0, 200) });
        this.nastav(e, z!, 'STARTUJE');
      })
      .finally(() => {
        z!.zahrivani = null;
      });
  }
}
