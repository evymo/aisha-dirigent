import { describe, expect, it } from 'vitest';
import { maskuj, souhrnChyby } from '../chyba-behu.js';

describe('souhrn chyby běhu — PROČ, ne jen „Exit code N“', () => {
  it('nese konec výstupu kontejneru', () => {
    const s = souhrnChyby(255, [
      { level: 'info', message: 'start' },
      { level: 'error', message: 'fetch failed: getaddrinfo ENOTFOUND backend.mesh.example' },
    ]);
    expect(s).toBe('Exit code 255 — info: start | error: fetch failed: getaddrinfo ENOTFOUND backend.mesh.example');
  });

  it('bez výstupu zůstane dosavadní tvar', () => {
    expect(souhrnChyby(1, [])).toBe('Exit code 1');
  });

  it('jen posledních 5 řádků a strop délky', () => {
    const logs = Array.from({ length: 20 }, (_, i) => ({ level: 'info', message: `radek-${i} ${'x'.repeat(200)}` }));
    const s = souhrnChyby(2, logs);
    expect(s).not.toContain('radek-14');
    expect(s).toContain('radek-15');
    expect(s.length).toBeLessThanOrEqual(600);
  });

  it('řídicí znaky (rámce multiplexu Dockeru) se zahodí', () => {
    const s = souhrnChyby(255, [{ level: 'info', message: '\u0001\u0000\u0000\u0000\u0000\u0000\u0000\u0012chyba spojeni' }]);
    expect(s).toBe('Exit code 255 — info: chyba spojeni');
  });

  it('⛔ tokeny a hesla z cizího výstupu se maskují', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlX3h4eA';
    const s = souhrnChyby(255, [
      { level: 'error', message: `Authorization: Bearer ${jwt}` },
      { level: 'error', message: 'login password=Tajne123 token: "abc-def" api_key=XYZ' },
    ]);
    expect(s).not.toContain(jwt);
    expect(s).not.toContain('Tajne123');
    expect(s).not.toContain('abc-def');
    expect(s).not.toContain('XYZ');
  });

  it('maskuj nesahá na běžný text', () => {
    expect(maskuj('broker nedosažen: ECONNREFUSED')).toBe('broker nedosažen: ECONNREFUSED');
  });
});
