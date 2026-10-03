import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HlidanyProud, PrilisVelke, SpatnyZacatek } from './hlidany-proud.js';
import { overBalik, type Uloziste } from './overeni-baliku.js';

/**
 * Doplnění balíčku do úložiště z DEKLAROVANÉHO zdroje — ať appku ani Kiosk Admina
 * nemusí nikdo nahrávat ručně.
 *
 * ⭐ ZADÁNÍ MAJITELE 2026-09-24: „je třeba, aby se spustil build, který balíček
 * nahraje do storage automaticky, aby uživatel nemusel". Build publikuje balíček
 * do registru a deklarace instance nese jeho `zdroj` a `sha256`. Úložiště se pak
 * srovná SAMO — při startu služby a znovu v intervalu.
 *
 * ⛔ ROZHODUJE OTISK Z DEKLARACE, NE ADRESA. Stáhne se do dočasného souboru, spočítá
 * se sha256 a do bucketu jde JEN balíček, jehož otisk sedí s deklarací. Registr,
 * který by podal něco jiného (přepsaná verze, chyba, podvrh), úložiště NEZMĚNÍ.
 * Co tam leží, zůstane — tablet si z něj stejně nic nevezme, protože seznam
 * nabízí jen soubor se shodným otiskem (routes/zarizeni.ts).
 *
 * ⛔ BEZ ZDROJE SE NIC NEVYMÝŠLÍ. Deklarace bez `zdroj` = jen ruční nahrání
 * v administraci; výsledek to řekne (`bez_zdroje`), nehledá se jinde.
 */
export type VysledekDoplneni =
  | { stav: 'nedeklarovano' }
  | { stav: 'drzi'; klic: string }
  | { stav: 'bez_zdroje'; klic: string; porucha: 'chybi' | 'nesedi' }
  | { stav: 'doplneno'; klic: string; bajtu: number }
  | { stav: 'zdroj_nesedi'; klic: string; deklarovano: string; stazeno: string }
  | { stav: 'zdroj_selhal'; klic: string; duvod: string };

export interface DoplneniVstup {
  /** Kam balíček patří, např. `appky/cz.riq.ridic.apk`. */
  klic: string;
  /** Otisk z deklarace — bez něj se nic nedoplňuje. */
  ocekavanySha256: string;
  /** Odkud stáhnout (deklarace), nebo nic. */
  zdroj?: string;
}

export interface DoplneniZavislosti {
  uloziste: Uloziste;
  /** Tělo balíčku ze zdroje; chyba = zdroj selhal. */
  stahni(url: string): Promise<Readable>;
  /** Uloží OVĚŘENÝ soubor pod klíč i s otiskem v metadatech. */
  uloz(klic: string, soubor: string, bajtu: number, sha256: string): Promise<void>;
  /** Strop velikosti — zdroj, který posílá víc, je vadný. */
  maxBajtu: number;
}

/** APK je ZIP: `PK\x03\x04`. Cokoli jiného se do bucketu nepustí. */
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export async function doplnBalik(vstup: DoplneniVstup, z: DoplneniZavislosti): Promise<VysledekDoplneni> {
  const v = await overBalik({ klic: vstup.klic, ocekavanySha256: vstup.ocekavanySha256 }, z.uloziste);
  if (v.stav === 'nedeklarovano' || v.stav === 'drzi') return v;
  if (!vstup.zdroj) return { stav: 'bez_zdroje', klic: vstup.klic, porucha: v.stav };

  const deklarovano = vstup.ocekavanySha256.toLowerCase();
  const adresar = await mkdtemp(join(tmpdir(), 'doplneni-'));
  const soubor = join(adresar, 'balicek.apk');
  try {
    const hlidac = new HlidanyProud(z.maxBajtu, { sha256: true, zacatek: ZIP });
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- per-call tmpdir (mkdtemp) + literál; ze zdroje do cesty nevede nic
      await pipeline(await z.stahni(vstup.zdroj), hlidac, createWriteStream(soubor));
    } catch (e) {
      const duvod = e instanceof PrilisVelke
        ? `zdroj poslal víc než ${z.maxBajtu} B`
        : e instanceof SpatnyZacatek
          ? 'zdroj neposlal APK (není to ZIP)'
          : String((e as Error)?.message ?? e);
      return { stav: 'zdroj_selhal', klic: vstup.klic, duvod };
    }
    const stazeno = (hlidac.sha256() ?? '').toLowerCase();
    if (stazeno !== deklarovano) return { stav: 'zdroj_nesedi', klic: vstup.klic, deklarovano, stazeno };
    await z.uloz(vstup.klic, soubor, hlidac.bajtu, stazeno);
    return { stav: 'doplneno', klic: vstup.klic, bajtu: hlidac.bajtu };
  } finally {
    // Dočasný soubor nesmí přežít ani úspěch, ani pád — desítky MB na disku služby.
    await rm(adresar, { recursive: true, force: true }).catch(() => {});
  }
}
