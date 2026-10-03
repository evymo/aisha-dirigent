/**
 * Stráž běžného uživatele (`requireUser`) — federace „za uživatele", ADR-004 bod 4, brána B1.
 *
 * Volající je VÝHRADNĚ ověřený token Keycloaku vydaný klientu webu instance
 * (`aud` i `azp` = OIDC_APP_CLIENT_ID). Měří se proti skutečnému ověřovateli
 * `@aisha/security` a lokálnímu JWKS (HTTP, jako Keycloak) — tokeny podepsané
 * skutečným klíčem, ne napodobená verifikace.
 *
 * Kladná kotva ve stejném běhu: platný token projde a routa vrátí jeho `sub`.
 */
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createAuthGuard, uzivatelZPozadavku } from '../auth-guard.js';
import type { SourceBrokerConfig } from '../config.js';

const REALM = 'fixtura';
const KLIENT_WEBU = 'web-instance-fixtura';
const SERVISNI_KLIC = 'servisni-klic-fixtura-0123456789';
const UZIVATEL = randomUUID();

type KeyLike = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

let jwksServer: Server;
let kcUrl = '';
let soukromy: KeyLike;
let cizi: KeyLike;
let app: FastifyInstance;

function config(extra: Partial<SourceBrokerConfig> = {}): SourceBrokerConfig {
  return {
    postgrestUrl: 'http://postgrest.invalid', postgrestServiceToken: 't', postgresUrl: 'postgres://t',
    keycloakUrl: kcUrl, keycloakRealm: REALM, oidcAppClientId: KLIENT_WEBU,
    sourceApiUrl: 'http://source.invalid', sourceServiceEmail: '', sourceServicePassword: '',
    sourcePgUrl: 'postgres://s', sourceAuthHandshakeOutgoing: '', sourceAuthHandshakeIncoming: '',
    jwtCacheTtlMs: 1, webhookHmacSecret: 's', syncIntervalMs: 1, port: 0, logLevel: 'silent',
    corsAllowlist: '', rateLimitEnabled: false, devAllowUnauthedSync: false,
    aishaGatewayUrl: 'http://g.invalid', aishaGatewayIntranetKey: SERVISNI_KLIC, aishaJwtSecret: '',
    aishaJwtExpSec: 3600, aishaMemberRole: 'authenticated',
    ...extra,
  } as SourceBrokerConfig;
}

async function token(
  claims: Record<string, unknown> = {},
  opts: { klic?: KeyLike; issuer?: string; exp?: string | number } = {},
): Promise<string> {
  const { sub, ...zbytek } = { sub: UZIVATEL, aud: KLIENT_WEBU, azp: KLIENT_WEBU, ...claims } as Record<string, unknown>;
  const jwt = new SignJWT(zbytek)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.issuer ?? `${kcUrl}/realms/${REALM}`)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m');
  if (sub !== undefined) jwt.setSubject(String(sub));
  return jwt.sign(opts.klic ?? soukromy);
}

async function aplikace(extra: Partial<SourceBrokerConfig> = {}): Promise<FastifyInstance> {
  const a = Fastify({ logger: false });
  const guard = createAuthGuard(config(extra));
  a.post('/kdo', { preHandler: guard.requireUser }, async (req) => ({ userId: uzivatelZPozadavku(req).userId }));
  await a.ready();
  return a;
}

const zavolej = (a: FastifyInstance, authorization?: string, body: unknown = {}) =>
  a.inject({ method: 'POST', url: '/kdo', headers: authorization ? { authorization } : {}, payload: body as object });

beforeAll(async () => {
  delete process.env.KC_ISSUER; // issuer odvozený z realmu, ne z prostředí stroje
  const par = await generateKeyPair('RS256');
  soukromy = par.privateKey;
  cizi = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(par.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  jwksServer = createServer((req, res) => {
    if (req.url === `/realms/${REALM}/protocol/openid-connect/certs`) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => jwksServer.listen(0, '127.0.0.1', () => r()));
  const adresa = jwksServer.address();
  kcUrl = `http://127.0.0.1:${typeof adresa === 'object' && adresa ? adresa.port : 0}`;
  app = await aplikace();
});

afterAll(async () => {
  await app?.close();
  await new Promise<void>((r) => jwksServer.close(() => r()));
});

describe('requireUser — volající jen z vlastního tokenu klienta webu instance (B1)', () => {
  it('kladná kotva: platný token klienta webu projde a routa vrátí jeho sub', async () => {
    const r = await zavolej(app, `Bearer ${await token()}`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().userId).toBe(UZIVATEL);
  });

  it('identita z těla se ignoruje — rozhoduje token (B1)', async () => {
    const r = await zavolej(app, `Bearer ${await token()}`, { userId: randomUUID(), sub: randomUUID() });
    expect(r.statusCode).toBe(200);
    expect(r.json().userId).toBe(UZIVATEL);
  });

  it('token JINÉHO klienta realmu (aud) → 401', async () => {
    const r = await zavolej(app, `Bearer ${await token({ aud: 'appsmith-proxy', azp: 'appsmith-proxy' })}`);
    expect(r.statusCode).toBe(401);
  });

  it('token vydal klient webu (azp), ale aud klienta webu NENESE → 401 (měří jen připnutí audience)', async () => {
    // Token klienta bez audience mapperu: aud = 'account', azp = klient webu. Kontrola azp projde;
    // odmítnout ho musí připnuté audience ověřovatele.
    const r = await zavolej(app, `Bearer ${await token({ aud: 'account' })}`);
    expect(r.statusCode).toBe(401);
  });

  it('aud sedí, ale token vydal jiný klient (azp) → 401', async () => {
    const r = await zavolej(app, `Bearer ${await token({ aud: [KLIENT_WEBU, 'account'], azp: 'aisha-dirigent-device' })}`);
    expect(r.statusCode).toBe(401);
  });

  it('prošlý token, cizí issuer i cizí klíč → 401', async () => {
    expect((await zavolej(app, `Bearer ${await token({}, { exp: Math.floor(Date.now() / 1000) - 60 })}`)).statusCode).toBe(401);
    expect((await zavolej(app, `Bearer ${await token({}, { issuer: `${kcUrl}/realms/jiny` })}`)).statusCode).toBe(401);
    expect((await zavolej(app, `Bearer ${await token({}, { klic: cizi })}`)).statusCode).toBe(401);
  });

  it('servisní klíč uživatele nenese → 401', async () => {
    expect((await zavolej(app, `Bearer ${SERVISNI_KLIC}`)).statusCode).toBe(401);
  });

  it('bez tokenu → 401, i když je zapnutý dev obchvat admin rout', async () => {
    const dev = await aplikace({ devAllowUnauthedSync: true });
    try {
      expect((await zavolej(dev)).statusCode).toBe(401);
      expect((await zavolej(dev, undefined, { userId: UZIVATEL })).statusCode).toBe(401);
    } finally {
      await dev.close();
    }
  });

  it('sub, který není uuid uživatele aishy → 401', async () => {
    expect((await zavolej(app, `Bearer ${await token({ sub: 'service-account-web' })}`)).statusCode).toBe(401);
  });

  // ⛔ Token z PROHLÍŽEČE nese VEŘEJNÝ issuer (adresa Keycloaku, kterou vidí uživatel), ne vnitřní adresu,
  // ze které broker bere JWKS. Bez KC_ISSUER by requireUser odmítl každý skutečný token uživatele
  // (třída naměřená 21. 9. na RIQ u dvanácti služeb — viz @aisha/security `ocekavanyIssuer`).
  describe('veřejný issuer (KC_ISSUER)', () => {
    it('s KC_ISSUER projde token s veřejným issuerem a vnitřní neprojde', async () => {
      const verejny = 'https://kc.verejny.invalid/realms/' + REALM;
      process.env.KC_ISSUER = verejny;
      const a = await aplikace();
      try {
        expect((await zavolej(a, `Bearer ${await token({}, { issuer: verejny })}`)).statusCode).toBe(200);
        expect((await zavolej(a, `Bearer ${await token()}`)).statusCode).toBe(401);
      } finally {
        delete process.env.KC_ISSUER;
        await a.close();
      }
    });

    it('compose brokeru doručí KC_ISSUER z veřejné domény Keycloaku (kotva nasazení)', () => {
      const koren = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
      const compose = readFileSync(join(koren, 'docker-compose.coolify-source-broker.yml'), 'utf8');
      expect(compose).toMatch(/^\s+KC_ISSUER: https:\/\/\$\{KEYCLOAK_DOMAIN_PUBLIC\}\/realms\/\$\{KEYCLOAK_REALM\}\s*$/m);
    });
  });
});
