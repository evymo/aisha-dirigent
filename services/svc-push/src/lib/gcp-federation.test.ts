/**
 * Testy federace ke Google bez dlouhověkého klíče.
 *
 * Kontext: organizace zakazuje `iam.disableServiceAccountKeyCreation`, takže klíč
 * service accountu vůbec nejde vytvořit. Federace je proto jediná cesta — a musí
 * být fail-closed: půlka nastavení není nastavení.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// Stráž má vlastní testy (packages/security). Tady je průchozí, ale ZAZNAMENÁVÁ,
// že se použila — jinak by nešlo odlišit „volá se přes stráž" od „volá se holým
// fetchem" a stub globálního fetch by prošel v obou případech.
const straz = vi.hoisted(() => ({
  pouziti: 0,
  nastaveni: [] as Array<{ hostAllowlist: string[]; allowedSchemes?: string[]; allowInternalNetworks?: boolean }>,
}));
vi.mock('@aisha/security', () => ({
  createSsrfGuard: (opts: {
    hostAllowlist: string[];
    allowedSchemes?: string[];
    allowInternalNetworks?: boolean;
  }) => {
    straz.nastaveni.push(opts);
    return {
      safeFetch: (url: string, init?: RequestInit) => {
        straz.pouziti += 1;
        return fetch(url, init);
      },
      check: vi.fn(),
    };
  },
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

import {
  exchangeForFederatedToken,
  federationDefects,
  fetchIssuerToken,
  getFederatedAccessToken,
  impersonateServiceAccount,
  readFederationConfig,
} from './gcp-federation.js';

const UPLNE = {
  GCP_WORKLOAD_IDENTITY_AUDIENCE:
    '//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/p/providers/kc',
  GCP_SERVICE_ACCOUNT_EMAIL: 'sa@projekt.iam.gserviceaccount.com',
  GCP_FEDERATION_TOKEN_URL: 'https://auth.example.test/realms/r/protocol/openid-connect/token',
  GCP_FEDERATION_CLIENT_ID: 'svc-push',
  GCP_FEDERATION_CLIENT_SECRET: 'tajne',
} as unknown as NodeJS.ProcessEnv;

beforeEach(() => {
  straz.pouziti = 0;
  straz.nastaveni.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

/** Odpověď fetch bez nutnosti tahat sem celý Response. */
const odpoved = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

describe('federace je fail-closed', () => {
  it('⭐ neúplné nastavení NENÍ nastavení', () => {
    expect(readFederationConfig(UPLNE)).not.toBeNull();
    for (const klic of Object.keys(UPLNE)) {
      const bez = { ...UPLNE } as Record<string, string>;
      delete bez[klic];
      expect(
        readFederationConfig(bez as unknown as NodeJS.ProcessEnv),
        `bez ${klic} se konfigurace nesmí tvářit jako platná — jinak se selhání ukáže až při odesílání`,
      ).toBeNull();
    }
  });

  it('prázdný řetězec se počítá jako chybějící', () => {
    expect(readFederationConfig({ ...UPLNE, GCP_FEDERATION_CLIENT_SECRET: '   ' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('vada pojmenuje KTERÝ klíč chybí', () => {
    expect(federationDefects(UPLNE)).toEqual([]);
    const bez = { ...UPLNE } as Record<string, string>;
    delete bez.GCP_SERVICE_ACCOUNT_EMAIL;
    expect(federationDefects(bez as unknown as NodeJS.ProcessEnv)).toEqual(['GCP_SERVICE_ACCOUNT_EMAIL']);
  });
});

describe('trojkrokový řetěz', () => {
  it('krok 1 vezme token od NAŠEHO vydavatele, ne odjinud', async () => {
    const volani: Array<{ url: string; body: string }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      volani.push({ url, body: String(init.body) });
      return odpoved({ access_token: 'kc-token' });
    });
    const cfg = readFederationConfig(UPLNE)!;
    expect(await fetchIssuerToken(cfg)).toBe('kc-token');
    expect(volani[0].url).toBe(UPLNE.GCP_FEDERATION_TOKEN_URL);
    expect(volani[0].body).toContain('grant_type=client_credentials');
    // publikum musí sedět s --allowed-audiences poskytovatele, jinak Google token odmítne
    expect(volani[0].body).toContain('audience=svc-push');
  });

  it('krok 2 posílá na Google STS správné publikum a typ tokenu', async () => {
    const volani: Array<{ url: string; body: string }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      volani.push({ url, body: String(init.body) });
      return odpoved({ access_token: 'sts-token' });
    });
    const cfg = readFederationConfig(UPLNE)!;
    expect(await exchangeForFederatedToken(cfg, 'kc-token')).toBe('sts-token');
    expect(volani[0].url).toBe('https://sts.googleapis.com/v1/token');
    expect(volani[0].body).toContain(encodeURIComponent(cfg.audience));
    expect(volani[0].body).toContain('token-exchange');
    expect(volani[0].body).toContain('subject_token=kc-token');
  });

  it('⭐ krok 3 impersonuje service account — federovaný token sám na FCM nestačí', async () => {
    let zachyceno: { url: string; auth: string } | null = null;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      zachyceno = { url, auth: String((init.headers as Record<string, string>).Authorization) };
      return odpoved({ accessToken: 'sa-token', expireTime: '2099-01-01T00:00:00Z' });
    });
    const cfg = readFederationConfig(UPLNE)!;
    const out = await impersonateServiceAccount(cfg, 'sts-token');
    expect(out.token).toBe('sa-token');
    expect(out.expiresAt).toBeGreaterThan(Date.now());
    expect(zachyceno!.url).toContain('iamcredentials.googleapis.com');
    expect(zachyceno!.url).toContain(encodeURIComponent(cfg.serviceAccountEmail));
    expect(zachyceno!.auth).toBe('Bearer sts-token');
  });

  it('chybějící expirace se kešuje krátce, ne na odhadnutou hodinu', async () => {
    vi.stubGlobal('fetch', async () => odpoved({ accessToken: 'sa-token' }));
    const out = await impersonateServiceAccount(readFederationConfig(UPLNE)!, 'x');
    expect(out.expiresAt).toBeLessThanOrEqual(Date.now() + 5 * 60_000 + 1000);
  });

  it('celý řetěz projde všemi třemi kroky ve správném pořadí', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(String(url));
      if (String(url).includes('iamcredentials')) return odpoved({ accessToken: 'final' });
      return odpoved({ access_token: 'mezitoken' });
    });
    const out = await getFederatedAccessToken(readFederationConfig(UPLNE)!);
    expect(out.token).toBe('final');
    expect(urls[0]).toContain('auth.example.test');
    expect(urls[1]).toContain('sts.googleapis.com');
    expect(urls[2]).toContain('iamcredentials.googleapis.com');
  });
});

describe('odchozí volání drží stráž (SSRF)', () => {
  it('⭐ všechny tři kroky jdou přes stráž, ne holým fetchem', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      String(url).includes('iamcredentials')
        ? odpoved({ accessToken: 'final' })
        : odpoved({ access_token: 'mezitoken' }),
    );
    await getFederatedAccessToken(readFederationConfig(UPLNE)!);
    expect(straz.pouziti, 'krok, který obejde stráž, by následoval 307 na cizí hostitele i s tělem POSTu').toBe(3);
  });

  it('seznam hostitelů drží oba Googlí i nastaveného vydavatele — a nikoho dalšího', async () => {
    vi.stubGlobal('fetch', async () => odpoved({ access_token: 'x' }));
    await fetchIssuerToken(readFederationConfig(UPLNE)!);
    expect(straz.nastaveni[0].hostAllowlist.sort()).toEqual(
      ['auth.example.test', 'iamcredentials.googleapis.com', 'sts.googleapis.com'].sort(),
    );
    // Vnitřní sítě ano — vydavatel může být kontejner vedle nás. Smyčka a metadata
    // (127.0.0.0/8, 169.254.0.0/16) zůstávají zavřené i tak, to řeší sama stráž.
    expect(straz.nastaveni[0].allowInternalNetworks).toBe(true);
  });

  it('⭐ http se povolí JEN když si ho operátor sám nastavil', async () => {
    vi.stubGlobal('fetch', async () => odpoved({ access_token: 'x' }));
    await fetchIssuerToken(readFederationConfig(UPLNE)!);
    expect(straz.nastaveni[0].allowedSchemes).toEqual(['https:']);

    straz.nastaveni.length = 0;
    const vnitrni = { ...UPLNE, GCP_FEDERATION_TOKEN_URL: 'http://keycloak-vedle-nas:80/realms/r/x' };
    await fetchIssuerToken(readFederationConfig(vnitrni as NodeJS.ProcessEnv)!);
    expect(straz.nastaveni[0].allowedSchemes).toContain('http:');
    expect(straz.nastaveni[0].hostAllowlist).toContain('keycloak-vedle-nas');
  });

  it('adresa, která není adresa, je vada konfigurace — ne chyba až při odesílání', () => {
    const rozbite = { ...UPLNE, GCP_FEDERATION_TOKEN_URL: 'auth.example.test/realms/r' };
    expect(readFederationConfig(rozbite as NodeJS.ProcessEnv)).toBeNull();
    expect(federationDefects(rozbite as NodeJS.ProcessEnv)).toContain('GCP_FEDERATION_TOKEN_URL');
  });
});

describe('selhání se neschovává', () => {
  it('nezdařený krok vyhodí chybu s kódem, ne prázdný token', async () => {
    vi.stubGlobal('fetch', async () => odpoved({ error: 'invalid_client' }, false, 401));
    await expect(fetchIssuerToken(readFederationConfig(UPLNE)!)).rejects.toThrow(/401/);
  });

  it('odpověď bez tokenu je chyba, ne prázdný řetězec', async () => {
    vi.stubGlobal('fetch', async () => odpoved({ neco_jineho: true }));
    await expect(fetchIssuerToken(readFederationConfig(UPLNE)!)).rejects.toThrow(/access_token/);
  });

  it('neúspěšná impersonace nese, KOHO se týkala', async () => {
    vi.stubGlobal('fetch', async () => odpoved({ error: 'permission denied' }, false, 403));
    await expect(impersonateServiceAccount(readFederationConfig(UPLNE)!, 'x')).rejects.toThrow(
      /sa@projekt\.iam\.gserviceaccount\.com/,
    );
  });
});
