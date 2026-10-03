import { describe, it, expect } from 'vitest';
import { overBalik, type Uloziste } from './overeni-baliku.js';

const OTISK = 'a'.repeat(64);
const uloziste = (mapa: Record<string, string>): Uloziste => ({
  otisk: async (k) => mapa[k] ?? null,
});

describe('ověření balíčku proti deklaraci', () => {
  const vstup = { klic: 'appky/cz.riq.ridic.apk', ocekavanySha256: OTISK };

  it('shodný otisk → drží', async () => {
    expect(await overBalik(vstup, uloziste({ [vstup.klic]: OTISK }))).toEqual({ stav: 'drzi', klic: vstup.klic });
  });

  it('⛔ „chybí" a „nesedí" jsou DVĚ různé poruchy, ne jedna', async () => {
    // Slít je do jednoho „není to v pořádku" by poslalo hledat na špatné místo:
    // chybí = správce nenahrál, nesedí = nahrál JINÝ balíček.
    expect(await overBalik(vstup, uloziste({}))).toEqual({ stav: 'chybi', klic: vstup.klic });
    const jiny = await overBalik(vstup, uloziste({ [vstup.klic]: 'b'.repeat(64) }));
    expect(jiny.stav).toBe('nesedi');
    if (jiny.stav === 'nesedi') expect(jiny.vUlozisti).toBe('b'.repeat(64));
  });

  it('otisk se porovnává bez ohledu na velikost písmen', async () => {
    expect((await overBalik({ ...vstup, ocekavanySha256: OTISK.toUpperCase() }, uloziste({ [vstup.klic]: OTISK }))).stav).toBe('drzi');
  });

  it('⛔ bez otisku v deklaraci se NEOVĚŘUJE — mlčí, netvrdí „drží"', async () => {
    expect(await overBalik({ klic: vstup.klic, ocekavanySha256: '' }, uloziste({ [vstup.klic]: OTISK }))).toEqual({ stav: 'nedeklarovano' });
    expect(await overBalik(null, uloziste({}))).toEqual({ stav: 'nedeklarovano' });
  });

  it('negativní kontrola: měřidlo umí odpovědět „ne"', async () => {
    // Bez tohohle by zelená znamenala jen, že se nic nezeptalo.
    expect((await overBalik(vstup, uloziste({ 'jiny/klic.apk': OTISK }))).stav).toBe('chybi');
  });
});
