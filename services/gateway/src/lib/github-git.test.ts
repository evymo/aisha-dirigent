import { describe, expect, it } from 'vitest';
import {
  commitFiles,
  contentsUrl,
  GITHUB_PUBLIC_API_URL,
  readGitHubConfig,
  type FetchLike,
  type GitHubRepoConfig,
} from './github-git.js';

const CFG: GitHubRepoConfig = { apiUrl: 'https://api.github.test', owner: 'acme', repo: 'platform', token: 'tok' };

type Volani = { url: string; method: string; headers: Record<string, string>; body?: Record<string, unknown> };

/** Náhrada sítě: odpovědi podle `METODA url`, zapisuje každé volání. */
function sit(odpovedi: Record<string, { status: number; json?: unknown }>): { f: FetchLike; volani: Volani[] } {
  const volani: Volani[] = [];
  const f: FetchLike = async (url, init) => {
    const method = String(init?.method ?? 'GET');
    volani.push({
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
      method,
      url,
    });
    const o = odpovedi[`${method} ${url}`] ?? { status: 404, json: { message: 'Not Found' } };
    return new Response(JSON.stringify(o.json ?? {}), { status: o.status });
  };
  return { f, volani };
}

describe('readGitHubConfig — fail-closed konfigurace', () => {
  it('⛔ bez GITHUB_REPOSITORY je funkce nenakonfigurovaná (žádné dosazené repo)', () => {
    expect(readGitHubConfig({ GITHUB_TOKEN: 't' })).toEqual({ ok: false, reason: 'GITHUB_REPOSITORY not configured' });
    expect(readGitHubConfig({ GITHUB_REPOSITORY: '  ', GITHUB_TOKEN: 't' }).ok).toBe(false);
  });

  it('⛔ bez GITHUB_TOKEN je funkce nenakonfigurovaná', () => {
    expect(readGitHubConfig({ GITHUB_REPOSITORY: 'acme/platform' })).toEqual({
      ok: false,
      reason: 'GITHUB_TOKEN not configured',
    });
  });

  it('⛔ repo mimo tvar owner/repo se odmítne (žádné hádání cesty)', () => {
    for (const spatne of ['platform', 'acme/platform/extra', 'https://github.com/acme/platform', '../x/y', '../x', 'acme/..']) {
      expect(readGitHubConfig({ GITHUB_REPOSITORY: spatne, GITHUB_TOKEN: 't' }).ok, spatne).toBe(false);
    }
  });

  it('prázdné GITHUB_API_URL = veřejné API; GHE adresa se použije bez koncového lomítka', () => {
    const verejne = readGitHubConfig({ GITHUB_REPOSITORY: 'acme/platform.git', GITHUB_TOKEN: 't' });
    expect(verejne).toEqual({
      ok: true,
      config: { apiUrl: GITHUB_PUBLIC_API_URL, owner: 'acme', repo: 'platform', token: 't' },
    });
    const ghe = readGitHubConfig({
      GITHUB_API_URL: 'https://git.example.com/api/v3/',
      GITHUB_REPOSITORY: 'acme/platform',
      GITHUB_TOKEN: 't',
    });
    expect(ghe.ok && ghe.config.apiUrl).toBe('https://git.example.com/api/v3');
  });

  it('⛔ API bez https se odmítne (token by šel nešifrovaně)', () => {
    const r = readGitHubConfig({ GITHUB_API_URL: 'http://api.github.test', GITHUB_REPOSITORY: 'a/b', GITHUB_TOKEN: 't' });
    expect(r).toEqual({ ok: false, reason: 'GITHUB_API_URL must use https' });
  });
});

describe('contentsUrl', () => {
  it('kóduje segmenty zvlášť, lomítka zůstávají oddělovači', () => {
    expect(contentsUrl(CFG, 'src/a b/c#d.ts')).toBe('https://api.github.test/repos/acme/platform/contents/src/a%20b/c%23d.ts');
  });

  it('⛔ odmítne průchod nahoru a prázdnou cestu', () => {
    expect(() => contentsUrl(CFG, '../secrets')).toThrow(/traversal/);
    expect(() => contentsUrl(CFG, '/')).toThrow(/empty/);
  });
});

describe('commitFiles — contents API', () => {
  const URL_A = 'https://api.github.test/repos/acme/platform/contents/src/a.ts';
  const URL_B = 'https://api.github.test/repos/acme/platform/contents/src/b.ts';

  it('nový soubor: PUT bez sha, base64 obsah, větev, hlavičky GitHub API', async () => {
    const { f, volani } = sit({ [`PUT ${URL_A}`]: { status: 201, json: { commit: { sha: 'c1' }, content: { sha: 'b1' } } } });
    const r = await commitFiles(CFG, 'aisha/x', [{ path: 'src/a.ts', content: 'hello' }], 'feat: x', f);
    expect(r).toEqual({ sha: 'c1', success: true });
    expect(volani.map((v) => `${v.method} ${v.url}`)).toEqual([`GET ${URL_A}?ref=aisha%2Fx`, `PUT ${URL_A}`]);
    const put = volani[1];
    expect(put.body).toEqual({ branch: 'aisha/x', content: Buffer.from('hello').toString('base64'), message: 'feat: x' });
    expect(put.headers.Authorization).toBe('Bearer tok');
    expect(put.headers.Accept).toBe('application/vnd.github+json');
  });

  it('existující soubor: PUT nese jeho sha (update, ne create)', async () => {
    const { f, volani } = sit({
      [`GET ${URL_A}?ref=main`]: { status: 200, json: { sha: 'old-blob' } },
      [`PUT ${URL_A}`]: { status: 200, json: { commit: { sha: 'c2' } } },
    });
    const r = await commitFiles(CFG, 'main', [{ path: 'src/a.ts', content: 'x' }], 'fix', f);
    expect(r.success).toBe(true);
    expect(volani[1].body?.sha).toBe('old-blob');
  });

  it('⛔ selhaný zápis skončí NAHLAS a další soubory se nepíšou', async () => {
    const { f, volani } = sit({ [`PUT ${URL_A}`]: { status: 422, json: { message: 'sha mismatch' } } });
    const r = await commitFiles(
      CFG,
      'main',
      [
        { path: 'src/a.ts', content: 'x' },
        { path: 'src/b.ts', content: 'y' },
      ],
      'fix',
      f,
    );
    expect(r).toEqual({ error: 'PUT src/a.ts → HTTP 422', sha: '', success: false });
    expect(volani.some((v) => v.url.startsWith(URL_B))).toBe(false);
  });

  it('⛔ síťová chyba při zápisu se přizná jako neúspěch (route nespadne)', async () => {
    const f: FetchLike = async (_url, init) => {
      if (init?.method === 'PUT') throw new Error('connect ETIMEDOUT');
      return new Response('{}', { status: 404 });
    };
    const r = await commitFiles(CFG, 'main', [{ path: 'src/a.ts', content: 'x' }], 'fix', f);
    expect(r).toEqual({ error: 'PUT src/a.ts failed: connect ETIMEDOUT', sha: '', success: false });
  });

  it('⛔ cesta s průchodem nahoru se vůbec nevolá', async () => {
    const { f, volani } = sit({});
    const r = await commitFiles(CFG, 'main', [{ path: '../x', content: 'x' }], 'fix', f);
    expect(r.success).toBe(false);
    expect(volani).toEqual([]);
  });
});
