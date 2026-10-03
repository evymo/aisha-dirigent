import { describe, it, expect } from 'vitest';
import { vydejToken, overToken, TokenError } from './nahravaci-token.js';

const TAJ = 'x'.repeat(40);
const PRAVO = { b: 'entity-evidence', k: 'u1/abc_foto.jpg', t: 'image/jpeg', max: 1000, exp: 2_000_000_000 };

describe('nahrávací token', () => {
  it('co se vydá, to se ověří', () => {
    expect(overToken(vydejToken(PRAVO, TAJ), TAJ, 1_900_000_000)).toEqual(PRAVO);
  });

  it('cizí tajemství, změněný obsah i vyměněný podpis neprojdou', () => {
    const t = vydejToken(PRAVO, TAJ);
    expect(() => overToken(t, 'y'.repeat(40), 0)).toThrow(TokenError);
    const [data, sig] = t.split('.');
    const jiny = Buffer.from(JSON.stringify({ ...PRAVO, k: 'cizi/klic' })).toString('base64url');
    expect(() => overToken(`${jiny}.${sig}`, TAJ, 0)).toThrow(/podpis/);
    expect(() => overToken(`${data}.${sig.slice(0, -2)}`, TAJ, 0)).toThrow(/podpis/);
  });

  it('prošlý token se odmítne s důvodem expirace', () => {
    const t = vydejToken({ ...PRAVO, exp: 100 }, TAJ);
    expect(() => overToken(t, TAJ, 100)).toThrow(/expirace/);
  });

  it('krátké tajemství se k vydání nepoužije', () => {
    expect(() => vydejToken(PRAVO, 'kratke')).toThrow(/too short/);
  });

  it('nesmyslný tvar je tvar, ne pád', () => {
    for (const t of ['', 'abc', 'a.b.c']) expect(() => overToken(t, TAJ, 0)).toThrow(TokenError);
  });
});

describe('volitelné documentId (d) — přísný tvar i u volitelného pole', () => {
  const zaklad = { b: 'uploads-quarantine', k: 'health-documents/u1/x.pdf', t: 'application/pdf', max: 10, exp: Math.floor(Date.now() / 1000) + 60 };

  it('token s d projde a d se vrátí', () => {
    expect(overToken(vydejToken({ ...zaklad, d: 'doc-1' }, TAJ), TAJ).d).toBe('doc-1');
  });

  it('token bez d projde — nahrávky bez evidence ho nemají', () => {
    expect(overToken(vydejToken(zaklad, TAJ), TAJ).d).toBeUndefined();
  });

  it('d jiného typu než řetězec = neplatný tvar, i když podpis sedí', () => {
    const spatny = vydejToken({ ...zaklad, d: 42 as unknown as string }, TAJ);
    expect(() => overToken(spatny, TAJ)).toThrow(TokenError);
  });
});
