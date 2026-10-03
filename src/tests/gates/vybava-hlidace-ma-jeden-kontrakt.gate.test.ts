import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vybavaDoBundlu as zeSkriptu } from '../../../apps/hlidac/scripts/qr.mjs';
import { vybavaDoBundlu as zWebu, obsahQr as obsahQrWeb } from '../../lib/zarizeni/qrHlidace';
import { obsahQr as obsahQrSkript } from '../../../apps/hlidac/scripts/qr.mjs';

/**
 * Výbava, kterou hlídač rozdává appce, má TŘI producenty QR a jednoho čtenáře:
 *   `apps/hlidac/scripts/qr.mjs`      — skript pro technika
 *   `src/lib/zarizeni/qrHlidace.ts`   — administrace (TAHLE cesta se používá nejvíc)
 *   `Vybava.java`                     — čtenář na tabletu
 * Jména klíčů jsou mezi nimi jediný kontrakt.
 *
 * ⛔ NAMĚŘENO 2026-09-22: třetí hlavu jsem málem přehlédl. Brána hlídala jen
 * dvojici skript↔Java, zatímco administrace stavěla QR BEZ výbavy — tablet
 * zavedený tou cestou (tedy tou obvyklou) by adresu nedostal a appka by mlčela.
 *
 * ⛔ PROČ BRÁNA. Přejmenování na jedné straně nic neshodí: překlad projde, testy
 * projde, QR se vygeneruje. Appka jen tiše nedostane adresu — a to se pozná AŽ
 * u tabletu, který „se nepřipojuje", tedy na místě a v čase nejdražším na
 * hledání. Táž třída jako `kid`, který se musí odvodit stejně na obou stranách.
 *
 * Univerzum se HLEDÁ (klíče se čtou ze zdrojáku), nepíše se sem ručně: ručně
 * psaný seznam by zestárl přesně ve chvíli, kdy někdo klíč přidá.
 */
const JAVA = resolve(__dirname, '../../../apps/hlidac/app/src/main/java/platforma/hlidac/Vybava.java');

function klieceZJavy(): string[] {
  const zdroj = readFileSync(JAVA, 'utf8');
  const nalezy = [...zdroj.matchAll(/static final String KLIC_\w+\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  return nalezy.sort();
}

const UPLNA = { apiUrl: 'https://api.test.cz', knock: { host: 'edge.test.cz', port: 62201, kid: 'test', scope: 'ridic' } };

describe('výbava hlídače má jeden kontrakt', () => {
  it('kontrolní vzorek: ve Vybava.java jsou klíče vůbec k nalezení', () => {
    // Bez tohohle by prázdný výsledek regulárního výrazu vypadal jako shoda.
    expect(klieceZJavy().length).toBeGreaterThanOrEqual(5);
  });

  it('OBA producenti QR vydávají PRÁVĚ ty klíče, které Vybava.java čte', () => {
    expect(Object.keys(zeSkriptu(UPLNA)).sort()).toEqual(klieceZJavy());
    expect(Object.keys(zWebu(UPLNA)).sort()).toEqual(klieceZJavy());
  });

  it('⛔ skript technika a administrace vydávají TOTÉŽ', () => {
    // Dvě cesty k témuž tabletu se nesmí lišit: technik by vybavil a
    // administrace ne (nebo naopak), a poznalo by se to až u zařízení.
    expect(zWebu(UPLNA)).toEqual(zeSkriptu(UPLNA));
    expect(zWebu({ apiUrl: 'https://api.test.cz' })).toEqual(zeSkriptu({ apiUrl: 'https://api.test.cz' }));
    expect(zWebu(undefined)).toEqual(zeSkriptu(undefined));
  });

  it('⛔ HOTOVÉ QR výbavu NESE — měří se výstup, ne pomocník', () => {
    // NAMĚŘENO 2026-09-22: brána testovala `vybavaDoBundlu` a zůstala zelená,
    // i když jsem z `obsahQr` smazal jeho VOLÁNÍ. Pomocník, který nikdo nevolá,
    // je přesně ta vada, kvůli které tahle brána vznikla.
    const BUNDLE = 'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE';
    const ocekavane = klieceZJavy();

    const web = obsahQrWeb({
      konfigurace: {
        spravce: 'cz.test.hlidac/platforma.hlidac.SpravceReceiver',
        checksum: 'AAAA',
        applicationId: 'cz.test.hlidac',
        vybava: UPLNA,
      },
      stazeni: 'https://x/y.apk',
      pinZaznam: 'pbkdf2$1$a$b',
    }) as Record<string, Record<string, unknown>>;
    for (const k of ocekavane) expect(Object.keys(web[BUNDLE]!)).toContain(k);

    const skript = obsahQrSkript({
      instance: {
        applicationId: 'cz.test.hlidac',
        signing: { certSha256: '4B:6E:9C:3E:90:DE:2B:9D:BF:76:5D:B2:B2:8F:B2:A7:20:5A:FB:23:B3:93:EA:5E:AC:13:5C:7F:BE:8A:28:00' },
        vybava: UPLNA,
      },
      apkUrl: 'https://x/y.apk',
      pinZaznam: 'pbkdf2$1$a$b',
    }) as Record<string, Record<string, unknown>>;
    for (const k of ocekavane) expect(Object.keys(skript[BUNDLE]!)).toContain(k);
  });

  it('bez dveří vydá jen adresu API — a ta je povinná', () => {
    expect(Object.keys(zeSkriptu({ apiUrl: 'https://api.test.cz' }))).toEqual(['platforma.hlidac.API_URL']);
    expect(() => zeSkriptu({ knock: UPLNA.knock })).toThrow(/apiUrl/);
  });

  it('⛔ částečná sada dveří se ODMÍTNE, nedoplní', () => {
    for (const vynech of ['host', 'port', 'kid', 'scope'] as const) {
      const k: Record<string, unknown> = { ...UPLNA.knock };
      delete k[vynech];
      expect(() => zeSkriptu({ ...UPLNA, knock: k })).toThrow(new RegExp(vynech));
    }
  });

  it('port se veze jako ŘETĚZEC a v platném rozsahu', () => {
    expect(zeSkriptu(UPLNA)['platforma.hlidac.KNOCK_PORT']).toBe('62201');
    expect(() => zeSkriptu({ ...UPLNA, knock: { ...UPLNA.knock, port: 0 } })).toThrow(/port/);
    expect(() => zeSkriptu({ ...UPLNA, knock: { ...UPLNA.knock, port: 70000 } })).toThrow(/port/);
  });

  it('výbava chybí → prázdno, ne výjimka (instance ji mít nemusí)', () => {
    expect(zeSkriptu(undefined)).toEqual({});
  });
});
