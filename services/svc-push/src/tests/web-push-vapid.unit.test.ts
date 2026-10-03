/**
 * Unit testy — ověření VAPID páru.
 *
 * Co se tu drží:
 *   1. platný pár projde
 *   2. ⛔ PŮLKA PÁRU NEPROJDE — veřejný z jednoho páru, soukromý z druhého
 *      (přesně ta tichá porucha: „proměnné jsou nastavené", a push přesto nedojde)
 *   3. vadný tvar se pozná dřív, než se něco odešle
 *   4. subjekt mimo `mailto:`/https se odmítne (RFC 8292)
 */
import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';

vi.mock('../config.js', () => ({ config: { vapidPublicKey: '', vapidPrivateKey: '', vapidSubject: '' } }));

const { overVapid } = await import('../lib/web-push.js');

function par() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const j = privateKey.export({ format: 'jwk' }) as { x: string; y: string; d: string };
  const bod = Buffer.concat([Buffer.from([0x04]), Buffer.from(j.x, 'base64url'), Buffer.from(j.y, 'base64url')]);
  return { verejny: bod.toString('base64url'), soukromy: j.d };
}

const SUBJEKT = 'https://riq.example';

describe('overVapid', () => {
  it('platný pár projde', () => {
    const p = par();
    expect(overVapid(p.verejny, p.soukromy, SUBJEKT)).toEqual({ ok: true });
  });

  it('⛔ půlka páru NEPROJDE — tohle je ta tichá porucha', () => {
    const a = par();
    const b = par();
    const v = overVapid(a.verejny, b.soukromy, SUBJEKT);
    expect(v.ok).toBe(false);
    expect(v.duvod).toContain('NEPATŘÍ');
  });

  it('prázdné klíče = nenastaveno, ne pád', () => {
    expect(overVapid('', '', SUBJEKT).ok).toBe(false);
    expect(overVapid('', '', SUBJEKT).duvod).toContain('nejsou nastavené');
  });

  it('náhodná hodnota správné DÉLKY se pozná podle tvaru bodu', () => {
    // Přesně to, co by vyrobil env-doktor, kdyby klíč chyběl: 65 náhodných bajtů.
    const nahoda = crypto.randomBytes(65).toString('base64url');
    const p = par();
    const v = overVapid(nahoda, p.soukromy, SUBJEKT);
    expect(v.ok).toBe(false);
  });

  it('krátký soukromý klíč se odmítne', () => {
    const p = par();
    const v = overVapid(p.verejny, crypto.randomBytes(16).toString('base64url'), SUBJEKT);
    expect(v.ok).toBe(false);
    expect(v.duvod).toContain('32 B');
  });

  it('subjekt musí být mailto: nebo https URL', () => {
    const p = par();
    expect(overVapid(p.verejny, p.soukromy, 'riq.example').ok).toBe(false);
    expect(overVapid(p.verejny, p.soukromy, 'mailto:provoz@riq.example')).toEqual({ ok: true });
  });
});
