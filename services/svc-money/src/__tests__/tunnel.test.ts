/**
 * Tunel: profil z proměnné, tajemství jen v tmpfs, a diagnostika, která
 * nepošle člověka ladit certifikát, když je vinen účet.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decodeProfile, writeSecrets, diagnose, stripCr, doplnDataCiphers } from '../lib/tunnel.js';

const PROFIL = 'client\nremote 203.0.113.85 443 tcp\ncipher AES-256-CBC\n';
const B64 = Buffer.from(PROFIL).toString('base64');
const uklid: string[] = [];
afterEach(() => { uklid.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })); });

function dir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'money-tunnel-'));
  uklid.push(d);
  return d;
}

describe('certifikát je PROMĚNNÁ, ne soubor v obrazu', () => {
  it('profil se rozbalí z base64', () => {
    expect(decodeProfile(B64)).toContain('remote 203.0.113.85');
  });

  it('prázdný nebo nesmyslný base64 je chyba, ne prázdný profil', () => {
    expect(() => decodeProfile('')).toThrow(/prázdný|base64/);
    expect(() => decodeProfile(Buffer.from('ahoj').toString('base64'))).toThrow(/ovpn|remote/);
  });

  it('⛔ CRLF se strhne — port `443\\r` je doložená past', () => {
    const crlf = Buffer.from('client\r\nremote 1.2.3.4 443\r\n').toString('base64');
    expect(decodeProfile(crlf)).not.toContain('\r');
  });
});

describe('tajemství jen na tmpfs, s právy 0600', () => {
  it('profil, auth i askpass mají práva 0600', () => {
    const d = dir();
    const { profile, auth, askpass } = writeSecrets(
      { profileB64: B64, authUser: 'u', authPass: 'p', keyPassphrase: 'k' }, d);
    for (const f of [profile, auth, askpass!]) {
      expect(statSync(f).mode & 0o777, `${f} musí být 0600`).toBe(0o600);
    }
  });

  it('auth soubor má pořadí uživatel → heslo (kontrakt openvpn)', () => {
    const d = dir();
    const { auth } = writeSecrets(
      { profileB64: B64, authUser: 'nemov.adm', authPass: 'tajne', keyPassphrase: '' }, d);
    expect(readFileSync(auth, 'utf8')).toBe('nemov.adm\ntajne\n');
  });

  it('bez hesla ke klíči se askpass nezakládá', () => {
    const d = dir();
    expect(writeSecrets(
      { profileB64: B64, authUser: 'u', authPass: 'p', keyPassphrase: '' }, d).askpass).toBeNull();
  });

  it('⛔ CRLF v hesle se strhne (jinak se pošle heslo s \\r)', () => {
    expect(stripCr('tajne\r')).toBe('tajne');
    const d = dir();
    const { auth } = writeSecrets(
      { profileB64: B64, authUser: 'u\r', authPass: 'p\r', keyPassphrase: '' }, d);
    expect(readFileSync(auth, 'utf8')).toBe('u\np\n');
  });
});

describe('diagnostika neposílá ladit špatnou věc', () => {
  it('úspěch nehlásí chybu', () => {
    expect(diagnose('… Initialization Sequence Completed')).toBeNull();
  });

  it('⭐ „Connection reset" ukáže na ÚČET, ne na certifikát', () => {
    // 2026-07-25: týž certifikát + jiný uživatel = tunel naskočil okamžitě.
    // Kdo čte log poprvé, jde jinak ladit certifikát a ztratí den.
    // Jméno brány je instanční údaj — test na něm nestojí, stačí, že ověření
    // serverového certifikátu PROŠLO a reset přišel až po něm.
    const log = 'VERIFY OK: depth=0, CN=VPN-GATEWAY\nConnection reset, restarting [0]';
    const d = diagnose(log)!;
    expect(d).toMatch(/ÚČET|AUTH_USER/);
    expect(d).toMatch(/2026-07-25/);
  });

  it('AUTH_FAILED se od resetu odliší', () => {
    expect(diagnose('AUTH_FAILED')).toMatch(/přihlašovací údaje/);
  });

  it('špatné heslo ke klíči se pozná zvlášť', () => {
    expect(diagnose('private key password verification failed')).toMatch(/klíči/);
  });
});

describe('doplnDataCiphers — profil musí umět vyjednat datovou šifru', () => {
  // ⛔ NAMĚŘENO 2026-08-26: připojení selhávalo, protože profil nesl jen
  // `cipher AES-256-CBC`. Od OpenVPN 2.5 se datová šifra vyjednává přes
  // `data-ciphers`; bez ní moderní protistraně nenabídneme nic přijatelného.
  const profil = (telo: string) => `client\nremote vpn.example.invalid 1194\n${telo}`;

  it('doplní data-ciphers, když profil má jen zastaralý cipher', () => {
    const out = doplnDataCiphers(profil('cipher AES-256-CBC\n'));
    expect(out).toMatch(/^data-ciphers AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305:AES-256-CBC$/m);
  });

  it('zastaralý cipher PONECHÁ — je to fallback pro starou protistranu', () => {
    const out = doplnDataCiphers(profil('cipher AES-256-CBC\n'));
    expect(out).toMatch(/^cipher AES-256-CBC$/m);
  });

  it('AEAD sady jsou PŘED zastaralou CBC', () => {
    const out = doplnDataCiphers(profil('cipher AES-256-CBC\n'));
    const sada = out.match(/^data-ciphers (\S+)$/m)![1].split(':');
    expect(sada.indexOf('AES-256-GCM')).toBeLessThan(sada.indexOf('AES-256-CBC'));
  });

  it('vlastní data-ciphers NEPŘEPÍŠE — deklarace operátora má přednost', () => {
    const vlastni = profil('data-ciphers CHACHA20-POLY1305\ncipher AES-256-CBC\n');
    expect(doplnDataCiphers(vlastni)).toBe(vlastni);
  });

  it('šifru z profilu, kterou výchozí sada nezná, NEZTRATÍ', () => {
    const out = doplnDataCiphers(profil('cipher CAMELLIA-256-CBC\n'));
    expect(out).toMatch(/^data-ciphers .*:CAMELLIA-256-CBC$/m);
  });

  it('profil bez cipher dostane sadu taky', () => {
    const out = doplnDataCiphers(profil('auth SHA256\n'));
    expect(out).toMatch(/^data-ciphers AES-256-GCM:/m);
  });
});
