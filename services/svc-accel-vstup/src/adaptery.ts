/**
 * LoRA adaptéry nájemců na chatovém enginu — načítá je ZA BĚHU výhradně vstup (VB).
 *
 * Rozhodnutí 2026-10-07 (Hackathon, varianta 2): engine má načítání za běhu zapnuté
 * (VLLM_ALLOW_RUNTIME_LORA_UPDATING), ale jeho endpoint je jen na interní síti jádra a chrání
 * ho klíč jádra, který má jen VB. Nájemci ho VB nepropouští (CESTA_NEZNAMA, vstup.ts).
 *
 * Dorovnání (pro každý chatový engine, po zahřátí a pak pravidelně):
 *   - adaptér, který engine servíruje a deklarace ho nezná → UVOLNIT + varování;
 *   - deklarovaný adaptér → načíst JEN z deklarovaného adresáře `/vahy/<repo>@<revize>` (svazek
 *     vah RO, stáhl a změřil accel-vahy), a jen když identita CELÉHO adresáře, přeměřená tady,
 *     sedí s deklarací i se souborem identity (revize i sha256). Nesoulad = NENAČÍST (a když
 *     engine adaptér už servíruje, uvolnit) — fail-closed;
 *   - adaptér načtený z jiného adresáře, než deklarace jmenuje (nová revize) → uvolnit a načíst znovu.
 * Po restartu enginu se tentýž seznam načte znovu (engine začíná bez adaptérů).
 *
 * Nájemce smí alias s adaptérem volat, až když ho dorovnání ověřilo proti AKTUÁLNÍ deklaraci a načetlo.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Engine } from './tabulka.js';

/**
 * Identita adresáře revize (`@vse`) — TÝŽ výpočet jako accel-vahy, entrypoint enginu a CLI operátora
 * (scripts/lib/accel-uzel.mjs --identita): sha256 seřazeného seznamu `relativní/cesta:sha256` všech
 * souborů mimo aisha-identita.json a .cache.
 */
export async function identitaAdresare(koren: string): Promise<string> {
  const radky: string[] = [];
  const projdi = async (adr: string, rel: string): Promise<void> => {
    for (const z of await readdir(adr, { withFileTypes: true })) {
      const r = rel ? `${rel}/${z.name}` : z.name;
      if (z.isDirectory()) {
        if (z.name !== '.cache') await projdi(join(adr, z.name), r);
      } else if (z.isFile() && z.name !== 'aisha-identita.json') {
        const h = createHash('sha256');
        for await (const kus of createReadStream(join(adr, z.name))) h.update(kus as Buffer);
        radky.push(`${r}:${h.digest('hex')}`);
      }
    }
  };
  await projdi(koren, '');
  if (radky.length === 0) throw new Error(`${koren} je prázdný`);
  // Řazení podle kódových bodů (= Python sorted), ne localeCompare.
  return createHash('sha256').update(radky.sort().join('\n')).digest('hex');
}

export interface MotorAdapteru {
  /** Adaptéry, které engine servíruje (bez základu): jméno → adresář (`root` z /v1/models). */
  servirovane(e: Engine): Promise<Map<string, string>>;
  nacti(e: Engine, jmeno: string, adresar: string): Promise<void>;
  uvolni(e: Engine, jmeno: string): Promise<void>;
}

export interface Disk {
  identita(adresar: string): Promise<string>;
  /** Soubor identity zapsaný accel-vahy při stažení (`aisha-identita.json`). */
  zapsana(adresar: string): Promise<{ sha256: string; revize: string }>;
}

export const diskSvazku: Disk = {
  identita: identitaAdresare,
  zapsana: async (a) => JSON.parse(await readFile(join(a, 'aisha-identita.json'), 'utf8')) as { sha256: string; revize: string },
};

export interface VysledekDorovnani {
  nacteno: string[];
  uvolneno: string[];
  odmitnuto: Array<{ jmeno: string; duvod: string }>;
}

export class Adaptery {
  /**
   * Engine → adaptér → PROTI ČEMU byl ověřen a načten (adresář + sha256). Mění se hned u každé
   * operace (uvolnit = smazat dřív, než se volá engine; zapsat až po úspěšném načtení), takže ani
   * výjimka uprostřed dorovnání nenechá stav tvrdit víc, než engine skutečně servíruje (revize
   * commitu f0e719d9f: drift stavu fail-open).
   */
  private overene = new Map<string, Map<string, { adresar: string; sha256: string }>>();

  private stavEnginu(engineId: string): Map<string, { adresar: string; sha256: string }> {
    let m = this.overene.get(engineId);
    if (!m) this.overene.set(engineId, (m = new Map()));
    return m;
  }

  constructor(
    private readonly motor: MotorAdapteru,
    private readonly disk: Disk = diskSvazku,
    private readonly hlaseni: (udalost: string, data: Record<string, unknown>) => void = () => {},
  ) {}

  /**
   * Smí nájemce volat adaptér? Jen ověřený a načtený PROTI AKTUÁLNÍ deklaraci (týž adresář i sha256).
   * Změní-li deklarace identitu, adaptér je nedostupný hned, ještě před dalším dorovnáním (fail-closed).
   */
  jeNacteny(e: Pick<Engine, 'id' | 'adaptery'>, jmeno: string): boolean {
    const r = this.overene.get(e.id)?.get(jmeno);
    const d = e.adaptery?.[jmeno];
    return r !== undefined && d !== undefined && r.adresar === d.adresar && r.sha256 === d.sha256;
  }

  /** Engine se restartoval / ztratil stav: zapomenout, co bylo načtené (dorovnání načte znovu). */
  zapomen(engineId: string): void {
    this.overene.delete(engineId);
  }

  private async over(jmeno: string, d: { sha256: string; revize: string; adresar: string }): Promise<string | null> {
    if (!d.adresar.endsWith(`@${d.revize}`)) return `adresář ${d.adresar} nenese revizi ${d.revize}`;
    let zapsana: { sha256: string; revize: string };
    try {
      zapsana = await this.disk.zapsana(d.adresar);
    } catch (err) {
      return `bez změřené identity (${String((err as Error)?.message ?? err).slice(0, 80)})`;
    }
    if (zapsana.revize !== d.revize || zapsana.sha256 !== d.sha256) return `změřená identita ${zapsana.sha256}@${zapsana.revize} ≠ deklarace ${d.sha256}@${d.revize}`;
    let zmereno: string;
    try {
      zmereno = await this.disk.identita(d.adresar);
    } catch (err) {
      return `adresář nejde přeměřit (${String((err as Error)?.message ?? err).slice(0, 80)})`;
    }
    if (zmereno !== d.sha256) return `přeměřeno ${zmereno} ≠ deklarace ${d.sha256} (obsah adresáře se změnil)`;
    return null;
  }

  async dorovnej(e: Engine): Promise<VysledekDorovnani> {
    const vysledek: VysledekDorovnani = { nacteno: [], uvolneno: [], odmitnuto: [] };
    if (e.druh !== 'generate') return vysledek;
    const deklarovane = e.adaptery ?? {};
    const servirovane = await this.motor.servirovane(e);
    const stav = this.stavEnginu(e.id);
    // Co engine nehlásí, není načtené (restart enginu, ruční uvolnění) — ať už si stav myslel cokoli.
    for (const jmeno of [...stav.keys()]) if (!servirovane.has(jmeno)) stav.delete(jmeno);
    for (const [jmeno, adresar] of servirovane) {
      if (jmeno in deklarovane) continue;
      stav.delete(jmeno);
      await this.motor.uvolni(e, jmeno);
      vysledek.uvolneno.push(jmeno);
      this.hlaseni('adapter_cizi_uvolnen', { engine: e.id, adapter: jmeno, adresar });
    }
    for (const [jmeno, d] of Object.entries(deklarovane)) {
      const odkud = servirovane.get(jmeno);
      // Načtený z deklarovaného adresáře a ověřený proti TÉŽE identitě: neměnný adresář se znovu neměří.
      if (odkud === d.adresar && this.jeNacteny(e, jmeno)) continue;
      stav.delete(jmeno);
      const vada = await this.over(jmeno, d);
      if (vada) {
        if (odkud !== undefined) {
          await this.motor.uvolni(e, jmeno);
          vysledek.uvolneno.push(jmeno);
        }
        vysledek.odmitnuto.push({ jmeno, duvod: vada });
        this.hlaseni('adapter_odmitnut', { engine: e.id, adapter: jmeno, duvod: vada });
        continue;
      }
      if (odkud !== undefined) {
        // Servírovaný, ale ne z ověřeného deklarovaného stavu (jiný adresář, nebo neznámý původ) → znovu.
        await this.motor.uvolni(e, jmeno);
        vysledek.uvolneno.push(jmeno);
      }
      await this.motor.nacti(e, jmeno, d.adresar);
      stav.set(jmeno, { adresar: d.adresar, sha256: d.sha256 });
      vysledek.nacteno.push(jmeno);
      this.hlaseni('adapter_nacten', { engine: e.id, adapter: jmeno, sha256: d.sha256 });
    }
    return vysledek;
  }
}
