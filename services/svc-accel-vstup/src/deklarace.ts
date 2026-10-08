/**
 * Deklarace uzlu ve svazku VB (`uzel.json`) — načtení, ověření a výměna ZA BĚHU.
 *
 * Rotace klíče nájemce i místní vypínač (podmínka Aishy 4) jsou jen nový obsah
 * souboru: VB ho přečte, ověří celý a tabulku vymění najednou. Žádný restart
 * sdílené komponenty — rotace A nesmí dát B jediné 401 (KJ2, MJ3, MN4).
 *
 * Nečitelný nebo neplatný soubor = DEKLARACE_NECITELNA pro všechny, ne tichá stará
 * tabulka (X3, MN5): kdo upravuje deklaraci, se o chybě dozví hned a nahlas.
 */
import { createHash } from 'node:crypto';
import { readFileSync, watch, type FSWatcher } from 'node:fs';
import { postavTabulku, type Tabulka } from './tabulka.js';

export type Stav = Tabulka | { necitelna: string };

export class Deklarace {
  private aktualni: Stav = { necitelna: 'deklarace ještě nebyla načtena' };
  private otisk = '';

  constructor(
    private readonly cesta: string,
    private readonly hlaseni: (udalost: string, data: Record<string, unknown>) => void = () => {},
  ) {}

  tabulka(): Stav {
    return this.aktualni;
  }

  /** sha256 obsahu platné deklarace; '' když platná není (měření k ní pak nepasuje). */
  otiskObsahu(): string {
    return 'necitelna' in this.aktualni ? '' : this.otisk;
  }

  /** Přečti soubor; vymění tabulku jen při změně obsahu. Vrací true, když se stav změnil. */
  nacti(): boolean {
    let text: string;
    try {
      text = readFileSync(this.cesta, 'utf8');
    } catch (e) {
      return this.nastavNecitelnou(`soubor nejde přečíst (${(e as NodeJS.ErrnoException).code ?? 'chyba'})`, '');
    }
    const otisk = createHash('sha256').update(text).digest('hex');
    if (otisk === this.otisk) return false;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return this.nastavNecitelnou('není platný JSON', otisk);
    }
    const r = postavTabulku(json);
    if ('vady' in r) return this.nastavNecitelnou(`neplatná: ${r.vady.slice(0, 5).join('; ')}`, otisk);
    this.aktualni = r.tabulka;
    this.otisk = otisk;
    this.hlaseni('deklarace_nactena', { najemcu: r.tabulka.najemci.size, enginu: r.tabulka.enginy.size, otisk: otisk.slice(0, 12) });
    return true;
  }

  private nastavNecitelnou(duvod: string, otisk: string): boolean {
    const zmena = !('necitelna' in this.aktualni) || this.aktualni.necitelna !== duvod;
    this.aktualni = { necitelna: duvod };
    this.otisk = otisk;
    if (zmena) this.hlaseni('deklarace_necitelna', { duvod });
    return zmena;
  }

  /** Sleduj soubor (watch + záložní poll — watch na svazku nemusí doručit vše). Vrací funkci pro ukončení. */
  sleduj(pollMs = 2000): () => void {
    this.nacti();
    let w: FSWatcher | null = null;
    try {
      w = watch(this.cesta, () => this.nacti());
    } catch {
      w = null; // soubor zatím není — poll ho najde
    }
    const t = setInterval(() => this.nacti(), pollMs);
    t.unref();
    return () => {
      clearInterval(t);
      w?.close();
    };
  }
}
