import { describe, expect, it } from 'vitest';
import {
  CESTA_METADAT_SERVERU_ZNALOSTI,
  CESTA_METADAT_ZDROJE,
  CESTA_SERVERU_ZNALOSTI,
  adresaMetadatServeruZnalosti,
  adresaServeruZnalosti,
  vyzvaKPrihlaseni,
} from './chraneny-zdroj.js';

describe('chráněný zdroj: adresy serveru znalostí', () => {
  it('metadata zdroje leží na kořeni metadat + cestě zdroje (RFC 9728 §3.1)', () => {
    expect(CESTA_METADAT_SERVERU_ZNALOSTI).toBe(`${CESTA_METADAT_ZDROJE}${CESTA_SERVERU_ZNALOSTI}`);
    expect(CESTA_METADAT_SERVERU_ZNALOSTI).toBe('/.well-known/oauth-protected-resource/functions/v1/mcp-knowledge-server');
  });

  it.each([
    ['https://api.example.test'],
    ['https://api.example.test/'],
    ['  https://api.example.test  '],
  ])('z veřejné adresy %j složí adresu zdroje i jeho metadat', (publicUrl) => {
    expect(adresaServeruZnalosti(publicUrl)).toBe('https://api.example.test/functions/v1/mcp-knowledge-server');
    expect(adresaMetadatServeruZnalosti(publicUrl)).toBe(
      'https://api.example.test/.well-known/oauth-protected-resource/functions/v1/mcp-knowledge-server',
    );
  });

  it('port veřejné adresy zůstává (místní vývoj)', () => {
    expect(adresaServeruZnalosti('http://localhost:3001')).toBe('http://localhost:3001/functions/v1/mcp-knowledge-server');
  });

  it('výzva k přihlášení nese adresu metadat zdroje v parametru resource_metadata', () => {
    expect(vyzvaKPrihlaseni('https://api.example.test')).toBe(
      'Bearer resource_metadata="https://api.example.test/.well-known/oauth-protected-resource/functions/v1/mcp-knowledge-server"',
    );
  });

  // Adresa se nehádá: co nejde složit jednoznačně, nevydá adresu ani výzvu.
  it.each([
    ['nenastavená', ''],
    ['jen mezery', '   '],
    ['není URL', 'api.example.test'],
    ['jiné schéma', 'ftp://api.example.test'],
    ['s cestou', 'https://example.test/api'],
    ['s dotazem', 'https://api.example.test/?x=1'],
    ['se jménem uživatele', 'https://jmeno@api.example.test'],
  ])('veřejná adresa %s → žádná adresa zdroje, žádná výzva', (_popis, publicUrl) => {
    expect(adresaServeruZnalosti(publicUrl)).toBeNull();
    expect(adresaMetadatServeruZnalosti(publicUrl)).toBeNull();
    expect(vyzvaKPrihlaseni(publicUrl)).toBeNull();
  });
});
