import { describe, it, expect } from 'vitest';
import { prectiRozsah } from './rozsah.js';

const V = 1000;

describe('čtení hlavičky Range', () => {
  it('bez hlavičky i s nesrozumitelnou → celý soubor', () => {
    expect(prectiRozsah(undefined, V)).toEqual({ druh: 'cely' });
    expect(prectiRozsah('nesmysl', V)).toEqual({ druh: 'cely' });
    expect(prectiRozsah('items=0-10', V)).toEqual({ druh: 'cely' });
  });

  it('bytes=0-99 dá prvních sto bajtů', () => {
    expect(prectiRozsah('bytes=0-99', V)).toEqual({ druh: 'cast', od: 0, do: 99, delka: 100 });
  });

  it('otevřený konec dojede do konce souboru — tím se NAVAZUJE', () => {
    // Tablet, kterému se přenos přerušil na 900. bajtu, řekne `bytes=900-`.
    expect(prectiRozsah('bytes=900-', V)).toEqual({ druh: 'cast', od: 900, do: 999, delka: 100 });
  });

  it('konec za koncem souboru se OŘÍZNE, ne odmítne', () => {
    // Klient legitimně nemusí znát velikost; RFC 9110 to řeší oříznutím.
    expect(prectiRozsah('bytes=990-99999', V)).toEqual({ druh: 'cast', od: 990, do: 999, delka: 10 });
  });

  it('záporný tvar dá POSLEDNÍCH n bajtů', () => {
    expect(prectiRozsah('bytes=-10', V)).toEqual({ druh: 'cast', od: 990, do: 999, delka: 10 });
    expect(prectiRozsah('bytes=-99999', V)).toEqual({ druh: 'cast', od: 0, do: 999, delka: 1000 });
  });

  it('⛔ chybný rozsah se NEOPRAVUJE — tiše posunutý by složil soubor ze špatných kusů', () => {
    expect(prectiRozsah('bytes=1000-', V)).toEqual({ druh: 'mimo' });
    expect(prectiRozsah('bytes=5000-6000', V)).toEqual({ druh: 'mimo' });
    expect(prectiRozsah('bytes=999-10', V)).toEqual({ druh: 'mimo' });
    expect(prectiRozsah('bytes=-0', V)).toEqual({ druh: 'mimo' });
  });

  it('prázdný objekt nemá co vydat', () => {
    expect(prectiRozsah('bytes=0-0', 0)).toEqual({ druh: 'mimo' });
  });

  it('negativní kontrola: měřidlo umí odpovědět jinak než „celý"', () => {
    expect(prectiRozsah('bytes=0-', V).druh).toBe('cast');
  });
});
