import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appConfigRoute } from './app-config.js';

const KEYS = [
  'API_DOMAIN_PUBLIC', 'APP_DOMAIN', 'GATEWAY_DOMAIN_PUBLIC', 'ANON_KEY',
  'APP_CONFIG_AISHA_URL', 'APP_CONFIG_WEB_URL', 'APP_CONFIG_ASK_URL',
  'PUBLIC_URL', 'FRONTEND_URL', 'KEYCLOAK_REALM', 'AUTH_DOMAIN_PUBLIC',
  'KEYCLOAK_DOMAIN_PUBLIC', 'KEYCLOAK_DOMAIN',
];

describe('appConfigRoute /.well-known/app-config.json', () => {
  let app: FastifyInstance;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  });
  afterEach(async () => {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    await app?.close();
  });

  async function get() {
    app = Fastify();
    await app.register(appConfigRoute);
    const res = await app.inject({ method: 'GET', url: '/.well-known/app-config.json' });
    return { status: res.statusCode, body: res.statusCode === 200 ? JSON.parse(res.body) : null };
  }

  it('derives PUBLIC urls from the domain vars — never localhost (the bootstrap bug)', async () => {
    process.env.ANON_KEY = 'anon-key';
    process.env.API_DOMAIN_PUBLIC = 'api.acme.example';       // bare host
    process.env.APP_DOMAIN = 'app.acme.example';
    process.env.GATEWAY_DOMAIN_PUBLIC = 'ask.acme.example';
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.aisha_url).toBe('https://api.acme.example');
    expect(body.web_url).toBe('https://app.acme.example');
    expect(body.ask_url).toBe('https://ask.acme.example/v1'); // model face for napoj
    expect(body.aisha_url).not.toContain('localhost');
  });

  it('APP_CONFIG_* overrides win over the domain vars', async () => {
    process.env.ANON_KEY = 'anon-key';
    process.env.API_DOMAIN_PUBLIC = 'api.acme.example';
    process.env.GATEWAY_DOMAIN_PUBLIC = 'ask.acme.example';
    process.env.APP_CONFIG_AISHA_URL = 'https://custom-api.acme.example';
    process.env.APP_CONFIG_ASK_URL = 'https://custom-ask.acme.example/v1';
    const { body } = await get();
    expect(body.aisha_url).toBe('https://custom-api.acme.example');
    expect(body.ask_url).toBe('https://custom-ask.acme.example/v1');
  });

  it('sentinel (.invalid) domain → empty ask_url (feature off, not a broken URL)', async () => {
    process.env.ANON_KEY = 'anon-key';
    process.env.API_DOMAIN_PUBLIC = 'api.acme.example';
    process.env.GATEWAY_DOMAIN_PUBLIC = 'gateway-disabled.invalid';
    const { body } = await get();
    expect(body.ask_url).toBe('');
  });

  it('keycloak_url derives from the per-instance domain — fork-portable, no donor TLD gating', async () => {
    process.env.ANON_KEY = 'anon-key';
    process.env.API_DOMAIN_PUBLIC = 'api.acme.example';
    process.env.KEYCLOAK_REALM = 'aisha';
    // A FORK's KC host — NOT *.aisha.guru. The old code gated on that literal and
    // returned '' here; now it must derive regardless of the donor TLD.
    process.env.KEYCLOAK_DOMAIN_PUBLIC = 'auth.acme.example';
    const { body } = await get();
    expect(body.keycloak_url).toBe('https://auth.acme.example/realms/aisha');
  });

  it('503 when no anon key (unchanged contract)', async () => {
    const { status } = await get();
    expect(status).toBe(503);
  });
});
