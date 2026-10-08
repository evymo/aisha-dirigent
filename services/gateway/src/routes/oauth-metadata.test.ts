import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Přihlášení klienta MCP přes OAuth: výzva u 401 ze serveru znalostí (routes/functions.ts)
// a metadata chráněného zdroje (routes/oauth-metadata.ts). Měří se PROPOJENÍ obou tras tak,
// jak je registruje server.ts — hlavička musí ukazovat na adresu, kterou gateway obslouží.
//
// `config` se čte při načtení modulu, proto si každý test natahuje trasy znovu
// (`vi.resetModules()`) nad prostředím, které sám deklaruje. Fastify se znovu nenatahuje.

const VEREJNA_ADRESA = 'https://api.example.test';
const VYDAVATEL = 'https://auth.example.test/realms/testrealm';
const MCP_UPSTREAM = 'http://test-mcp-knowledge.mesh.test.internal:3017';
const PLUGIN_UPSTREAM = 'http://test-plugin-system.mesh.test.internal:3029';

const ADRESA_ZDROJE = `${VEREJNA_ADRESA}/functions/v1/mcp-knowledge-server`;
const ADRESA_METADAT = `${VEREJNA_ADRESA}/.well-known/oauth-protected-resource/functions/v1/mcp-knowledge-server`;

/** Klíče prostředí, které test nastavuje — po testu se vrací do původního stavu. */
const KLICE = [
  'NODE_ENV', 'PUBLIC_URL', 'API_DOMAIN_PUBLIC', 'KC_ISSUER',
  'MCP_SERVICE_URL', 'SVC_MCP_KNOWLEDGE_URL', 'PLUGIN_SERVICE_URL',
] as const;

describe('přihlášení klienta MCP: výzva u 401 a metadata chráněného zdroje', () => {
  let app: FastifyInstance;
  let puvodni: Record<string, string | undefined>;
  let fetchMock: ReturnType<typeof vi.fn>;

  /** Postaví gateway (obě trasy jako v server.ts) nad zadaným prostředím. */
  async function postav(prostredi: Partial<Record<(typeof KLICE)[number], string>>): Promise<void> {
    for (const k of KLICE) delete process.env[k];
    Object.assign(process.env, {
      KC_ISSUER: VYDAVATEL,
      SVC_MCP_KNOWLEDGE_URL: MCP_UPSTREAM,
      PLUGIN_SERVICE_URL: PLUGIN_UPSTREAM,
      ...prostredi,
    });
    vi.resetModules();
    const { oauthMetadataRoutes } = await import('./oauth-metadata.js');
    const { functionsProxy } = await import('./functions.js');
    app = Fastify();
    await app.register(oauthMetadataRoutes);
    await app.register(functionsProxy, { prefix: '/functions/v1' });
  }

  /** Odpověď služby za proxy. */
  function sluzbaOdpovi(status: number, hlavicky: Record<string, string> = {}): void {
    fetchMock.mockImplementation(
      async () => new Response(status === 204 ? null : '{"jsonrpc":"2.0","error":{"code":-32000,"message":"x"},"id":1}', {
        status,
        headers: { 'content-type': 'application/json', ...hlavicky },
      }),
    );
  }

  const zavolej = (url: string, method: 'GET' | 'POST' = 'POST') =>
    app.inject({
      method,
      url,
      ...(method === 'POST'
        ? { headers: { 'content-type': 'application/json' }, payload: { jsonrpc: '2.0', method: 'initialize', id: 1 } }
        : {}),
    });

  beforeEach(() => {
    puvodni = {};
    for (const k of KLICE) puvodni[k] = process.env[k];
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    await app?.close();
    for (const k of KLICE) {
      if (puvodni[k] === undefined) delete process.env[k];
      else process.env[k] = puvodni[k];
    }
    vi.unstubAllGlobals();
  });

  describe('s veřejnou adresou gatewaye', () => {
    beforeEach(() => postav({ PUBLIC_URL: VEREJNA_ADRESA }));

    it('401 ze serveru znalostí nese výzvu s adresou metadat zdroje', async () => {
      sluzbaOdpovi(401);
      const odpoved = await zavolej('/functions/v1/mcp-knowledge-server');
      expect(odpoved.statusCode).toBe(401);
      expect(odpoved.headers['www-authenticate']).toBe(`Bearer resource_metadata="${ADRESA_METADAT}"`);
      // Tělo služby se nemění — výzva je jen hlavička navíc.
      expect(odpoved.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32000 } });
    });

    it('401 z podcesty serveru znalostí nese tutéž výzvu', async () => {
      sluzbaOdpovi(401);
      const odpoved = await zavolej('/functions/v1/mcp-knowledge-server/tools?x=1');
      expect(fetchMock.mock.calls[0]?.[0]).toBe(`${MCP_UPSTREAM}/mcp/tools?x=1`);
      expect(odpoved.statusCode).toBe(401);
      expect(odpoved.headers['www-authenticate']).toBe(`Bearer resource_metadata="${ADRESA_METADAT}"`);
    });

    it('403 výzvu nenese — přihlášený, který nesmí, se novým přihlášením nespraví', async () => {
      sluzbaOdpovi(403);
      const odpoved = await zavolej('/functions/v1/mcp-knowledge-server');
      expect(odpoved.statusCode).toBe(403);
      expect(odpoved.headers['www-authenticate']).toBeUndefined();
    });

    it('úspěšná odpověď výzvu nenese', async () => {
      sluzbaOdpovi(200);
      const odpoved = await zavolej('/functions/v1/mcp-knowledge-server');
      expect(odpoved.statusCode).toBe(200);
      expect(odpoved.headers['www-authenticate']).toBeUndefined();
    });

    // Kotva: jiná funkce TÉŽE služby i funkce jiné služby — chráněným zdrojem je jen koncový bod MCP.
    it.each([
      ['jiná funkce téže služby', '/functions/v1/ragnarok-search'],
      ['funkce jiné služby', '/functions/v1/plugin-host'],
      ['podcesta jiné funkce', '/functions/v1/plugin-host/mcp-knowledge-server'],
    ])('401 z jiné trasy (%s) výzvu nenese', async (_popis, url) => {
      sluzbaOdpovi(401);
      const odpoved = await zavolej(url);
      expect(odpoved.statusCode).toBe(401);
      expect(odpoved.headers['www-authenticate']).toBeUndefined();
    });

    it('výzvu, kterou poslala služba za proxy, gateway nepřepíše', async () => {
      const odSluzby = 'Bearer error="invalid_token", error_description="token expired"';
      sluzbaOdpovi(401, { 'WWW-Authenticate': odSluzby });
      const odpoved = await zavolej('/functions/v1/mcp-knowledge-server');
      expect(odpoved.statusCode).toBe(401);
      expect(odpoved.headers['www-authenticate']).toBe(odSluzby);
    });

    it('adresa z výzvy je obsloužená a `resource` = adresa koncového bodu', async () => {
      sluzbaOdpovi(401);
      const vyzva = String((await zavolej('/functions/v1/mcp-knowledge-server')).headers['www-authenticate']);
      const adresaMetadat = /^Bearer resource_metadata="([^"]+)"$/.exec(vyzva)?.[1];
      expect(adresaMetadat, 'výzva nenese parametr resource_metadata').toBeDefined();

      const url = new URL(adresaMetadat as string);
      expect(url.origin).toBe(VEREJNA_ADRESA);
      const metadata = await zavolej(url.pathname, 'GET');
      expect(metadata.statusCode).toBe(200);
      expect(metadata.json()).toEqual({
        resource: ADRESA_ZDROJE,
        authorization_servers: [VYDAVATEL],
        bearer_methods_supported: ['header'],
        scopes_supported: ['openid', 'email', 'profile'],
        resource_name: 'AISHA Knowledge MCP Server',
      });
    });

    // Kotva: dokument na kořeni popisuje gateway jako celek a zůstává, jak byl.
    it('kořenový dokument má dál origin gatewaye', async () => {
      const koren = await zavolej('/.well-known/oauth-protected-resource', 'GET');
      expect(koren.statusCode).toBe(200);
      expect(koren.json()).toEqual({
        resource: VEREJNA_ADRESA,
        authorization_servers: [VYDAVATEL],
        bearer_methods_supported: ['header'],
        scopes_supported: ['openid', 'email', 'profile'],
        resource_name: 'AISHA API Gateway',
      });
    });
  });

  it('veřejná adresa odvozená z API_DOMAIN_PUBLIC dá tutéž výzvu', async () => {
    await postav({ NODE_ENV: 'production', API_DOMAIN_PUBLIC: 'api.example.test' });
    sluzbaOdpovi(401);
    const odpoved = await zavolej('/functions/v1/mcp-knowledge-server');
    expect(odpoved.headers['www-authenticate']).toBe(`Bearer resource_metadata="${ADRESA_METADAT}"`);
  });

  describe('bez veřejné adresy gatewaye (produkce bez PUBLIC_URL i API_DOMAIN_PUBLIC)', () => {
    beforeEach(() => postav({ NODE_ENV: 'production' }));

    it('401 ze serveru znalostí výzvu nenese — adresa se nehádá', async () => {
      sluzbaOdpovi(401);
      const odpoved = await zavolej('/functions/v1/mcp-knowledge-server');
      expect(odpoved.statusCode).toBe(401);
      expect(odpoved.headers['www-authenticate']).toBeUndefined();
    });

    it('metadata zdroje se nevydají: 503 s důvodem, ne dokument bez adresy', async () => {
      const metadata = await zavolej('/.well-known/oauth-protected-resource/functions/v1/mcp-knowledge-server', 'GET');
      expect(metadata.statusCode).toBe(503);
      expect(metadata.json()).toMatchObject({ error: 'resource_metadata_unavailable' });
      expect(metadata.json().resource).toBeUndefined();
    });

    it('kořenový dokument odpovídá jako dřív', async () => {
      const koren = await zavolej('/.well-known/oauth-protected-resource', 'GET');
      expect(koren.statusCode).toBe(200);
      expect(koren.json()).toMatchObject({ authorization_servers: [VYDAVATEL], resource_name: 'AISHA API Gateway' });
    });
  });
});
