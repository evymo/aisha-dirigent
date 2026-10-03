/**
 * Klepání z appky — logika, ne nativní vrstva.
 *
 * Testuje se `knock.ts`, který je ZÁMĚRNĚ čistý: primitiva i odeslání se
 * injektují přes `KnockDeps`, takže tady dodáme Node krypto a falešný odesílač.
 * Nativní adaptér (`knock-native.ts`) se netahá — jest by na jeho C++ spadl.
 *
 * ⭐ CO SE OVĚŘUJE: rámec složený z KÓDU ČLOVĚKA na této straně SERVER OVĚŘÍ.
 * Kdyby appka odvodila klíče jinak než platforma, tenhle test to chytí dřív než
 * uživatel, který by koukal na „zaťukáno" a nic by se nedělo.
 */
import crypto from 'node:crypto';
import { knockOnce, knockWithCode, type KnockDeps } from '@/lib/knock';
import {
  verifyFrame, decodeFrame, deriveFromPassword,
  type KnockCrypto, type Operator,
} from '@aisha/knock-protocol';

const nodeCrypto: KnockCrypto = {
  hmacSha256: (key, msg) => new Uint8Array(crypto.createHmac('sha256', Buffer.from(key)).update(Buffer.from(msg)).digest()),
  randomBytes: (n) => new Uint8Array(crypto.randomBytes(n)),
  scryptSync: (p, s, len, o) => new Uint8Array(crypto.scryptSync(Buffer.from(p), Buffer.from(s), len, o)),
};

/** Serverové ověření z týchž kanonických parametrů, jaké má svc-knock (config.ts). */
function serverVerify(frame: Uint8Array, roster: Record<string, Operator>, now: number) {
  return verifyFrame(decodeFrame(frame), {
    crypto: nodeCrypto,
    operators: roster,
    now,
    windowSec: 30,
    otpStep: 30,
    otpDigits: 6,
    otpSkew: 1,
  });
}

/** Deps, které místo odeslání ZACHYTÍ datagram — tak se dá ověřit jeho obsah. */
function captureDeps(nowSec = 1_700_000_000): { deps: KnockDeps; sent: Uint8Array[] } {
  const sent: Uint8Array[] = [];
  return {
    sent,
    deps: {
      crypto: nodeCrypto,
      sendDatagram: async (bytes) => { sent.push(bytes); },
      nowSec: () => nowSec,
    },
  };
}

const TARGET = { kid: 'clovek-1', host: '203.0.113.9', port: 18181, scope: 'ops' };

describe('knockWithCode — vědomé klepání kódem člověka', () => {
  it('rámec z kódu SERVER přijme (týž protokol na obou stranách)', async () => {
    const now = 1_700_000_000;
    const { deps, sent } = captureDeps(now);
    const res = await knockWithCode('tajny-kod', TARGET, deps);

    expect(res.sent).toBe(true);
    expect(sent).toHaveLength(1);

    // Roster serveru = TÝŽ materiál odvozený z TÉHOŽ kódu. Kdyby se derivace
    // v appce a v jádru rozešly, verifyFrame by rámec odmítl.
    const secrets = deriveFromPassword(nodeCrypto, 'tajny-kod', TARGET.kid);
    const roster: Record<string, Operator> = { [TARGET.kid]: { ...secrets, scopes: ['ops'] } };
    const verdict = serverVerify(sent[0], roster, now);
    // Důvod do hlášky patří, ale jest `expect` druhý argument nebere — dá se do zprávy ručně.
    if (!verdict.ok) throw new Error(`server rámec odmítl: ${verdict.reason}`);
    expect(verdict.ok).toBe(true);
  });

  it('`sent` NEZNAMENÁ „otevřeno" — jen že datagram odešel', async () => {
    const { deps } = captureDeps();
    const res = await knockWithCode('tajny-kod', TARGET, deps);
    // Kontrakt výsledku: pole se jmenuje `sent`, ne `opened`. Dveře mlčí, takže
    // víc než „odesláno" klient tvrdit NESMÍ.
    expect(res).toHaveProperty('sent');
    expect(res).not.toHaveProperty('opened');
  });

  it('selhání odeslání se HLÁSÍ, nepolyká (uživatel musí vědět, že se neťuklo)', async () => {
    const deps: KnockDeps = {
      crypto: nodeCrypto,
      sendDatagram: async () => { throw new Error('letadlový režim'); },
      nowSec: () => 1_700_000_000,
    };
    const res = await knockWithCode('tajny-kod', TARGET, deps);
    expect(res.sent).toBe(false);
    expect(res.error).toMatch(/letadlový/);
  });

  it('bez scryptu (platforma ho nedodá) selže HLASITĚ, ne tichým odesláním', async () => {
    const bezScryptu: KnockDeps = {
      crypto: { hmacSha256: nodeCrypto.hmacSha256, randomBytes: nodeCrypto.randomBytes },
      sendDatagram: async () => { /* nemělo by se zavolat */ },
      nowSec: () => 1_700_000_000,
    };
    const res = await knockWithCode('tajny-kod', TARGET, bezScryptu);
    expect(res.sent).toBe(false);
    expect(res.error).toMatch(/scrypt/i);
  });

  it('týž kód dá deterministicky týž rámec (mimo nonce) — kód se nikam neukládá', async () => {
    const a = captureDeps(1_700_000_000);
    const b = captureDeps(1_700_000_000);
    await knockWithCode('tajny-kod', TARGET, a.deps);
    await knockWithCode('tajny-kod', TARGET, b.deps);
    // Rámce se liší jen náhodným nonce; ověříme, že OBA server přijme týmž rosterem.
    const secrets = deriveFromPassword(nodeCrypto, 'tajny-kod', TARGET.kid);
    const roster: Record<string, Operator> = { [TARGET.kid]: { ...secrets, scopes: ['ops'] } };
    for (const frame of [a.sent[0], b.sent[0]]) {
      expect(serverVerify(frame, roster, 1_700_000_000).ok).toBe(true);
    }
  });

  it('knockOnce s hotovým pověřením zařízení jede toutéž cestou', async () => {
    const { deps, sent } = captureDeps(1_700_000_000);
    const secrets = deriveFromPassword(nodeCrypto, 'jiny-kod', 'zarizeni-x');
    const res = await knockOnce({ ...secrets, kid: 'zarizeni-x', host: TARGET.host, port: TARGET.port, scope: 'ops' }, deps);
    expect(res.sent).toBe(true);
    expect(sent).toHaveLength(1);
  });
});
