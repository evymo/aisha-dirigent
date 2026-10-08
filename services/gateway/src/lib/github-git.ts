/**
 * GitHub REST — zápis souborů do větve přes contents API (dev-patch).
 *
 * Kód platformy žije na GitHubu; dev-patch commituje navržené soubory do větve
 * repozitáře, který deklaruje OPERÁTOR:
 *
 *   GITHUB_REPOSITORY  `owner/repo` — POVINNÉ, nedosazuje se. Chybí-li, funkce
 *                      hlásí „not configured" a nic nezapíše. Dosazené repo
 *                      by commitovalo do cizího (donorova) repozitáře.
 *   GITHUB_TOKEN       token s právem zápisu obsahu do toho repa — POVINNÝ.
 *   GITHUB_API_URL     základ REST API; prázdné = veřejné GitHub API
 *                      (GitHub Enterprise ho přepíše na `https://<host>/api/v3`).
 *
 * Endpointy: `GET/PUT /repos/{owner}/{repo}/contents/{path}` — PUT vytváří i
 * aktualizuje; u existujícího souboru musí nést jeho `sha`.
 */

/** Veřejné GitHub REST API — výchozí základ, když operátor nedeklaruje jiný (GHE). */
export const GITHUB_PUBLIC_API_URL = 'https://api.github.com';

export interface GitHubRepoConfig {
  apiUrl: string;
  token: string;
  owner: string;
  repo: string;
}

export type GitHubConfigResult =
  | { ok: true; config: GitHubRepoConfig }
  | { ok: false; reason: string };

export interface GitHubFile {
  content: string;
  path: string;
}

export interface GitHubCommitResult {
  /** SHA commitu posledního zapsaného souboru (`''` když se nic nezapsalo). */
  sha: string;
  success: boolean;
  /** Proč zápis neproběhl — bez tokenu a bez obsahu odpovědi. */
  error?: string;
}

/** Fetch-kompatibilní funkce (v provozu SSRF guard, v testech náhrada). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** owner: písmena/číslice/pomlčka; repo: navíc `.` a `_`, ale ne `.`/`..` samotné. */
const REPOSITORY_RE = /^([A-Za-z0-9][A-Za-z0-9-]*)\/(?!\.{1,2}$)([A-Za-z0-9_.-]+)$/;

/**
 * Konfigurace z prostředí. Jména se čtou VÝSLOVNĚ (`process.env.X`), aby brána
 * gateway-env-v-compose viděla, co musí compose doručit.
 */
export function readGitHubConfig(
  env: { GITHUB_API_URL?: string; GITHUB_TOKEN?: string; GITHUB_REPOSITORY?: string } = {
    GITHUB_API_URL: process.env.GITHUB_API_URL,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
  },
): GitHubConfigResult {
  const repository = (env.GITHUB_REPOSITORY ?? '').trim().replace(/\.git$/, '');
  if (!repository) return { ok: false, reason: 'GITHUB_REPOSITORY not configured' };
  const m = REPOSITORY_RE.exec(repository);
  if (!m) return { ok: false, reason: 'GITHUB_REPOSITORY must have the form owner/repo' };

  const token = (env.GITHUB_TOKEN ?? '').trim();
  if (!token) return { ok: false, reason: 'GITHUB_TOKEN not configured' };

  const apiUrl = ((env.GITHUB_API_URL ?? '').trim() || GITHUB_PUBLIC_API_URL).replace(/\/+$/, '');
  if (!apiUrl.startsWith('https://')) return { ok: false, reason: 'GITHUB_API_URL must use https' };

  return { ok: true, config: { apiUrl, owner: m[1], repo: m[2], token } };
}

/** `…/contents/{path}` — každý segment cesty zvlášť, lomítka zůstanou oddělovači. */
export function contentsUrl(cfg: GitHubRepoConfig, path: string): string {
  const segments = path
    .split('/')
    .filter((s) => s !== '' && s !== '.')
    .map((s) => {
      if (s === '..') throw new Error(`path traversal in ${path}`);
      return encodeURIComponent(s);
    });
  if (segments.length === 0) throw new Error('empty file path');
  return `${cfg.apiUrl}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${segments.join('/')}`;
}

function headers(cfg: GitHubRepoConfig, withBody: boolean): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${cfg.token}`,
    'User-Agent': 'aisha-gateway',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (withBody) h['Content-Type'] = 'application/json';
  return h;
}

/** SHA existujícího souboru ve větvi, `undefined` když soubor neexistuje. */
async function existingSha(cfg: GitHubRepoConfig, url: string, branch: string, doFetch: FetchLike): Promise<string | undefined> {
  try {
    const resp = await doFetch(`${url}?ref=${encodeURIComponent(branch)}`, {
      headers: headers(cfg, false),
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return undefined;
    const body = (await resp.json()) as { sha?: unknown };
    return typeof body.sha === 'string' ? body.sha : undefined;
  } catch {
    // Soubor neexistuje / nedostupný — zápis níž rozhodne nahlas.
    return undefined;
  }
}

/**
 * Zapíše soubory do EXISTUJÍCÍ větve, každý jako samostatný commit (contents API).
 * Při prvním neúspěšném zápisu skončí — zbytek se nepíše, výsledek to přizná.
 */
export async function commitFiles(
  cfg: GitHubRepoConfig,
  branch: string,
  files: GitHubFile[],
  message: string,
  doFetch: FetchLike,
): Promise<GitHubCommitResult> {
  let lastSha = '';
  for (const file of files) {
    let url: string;
    try {
      url = contentsUrl(cfg, file.path);
    } catch (e) {
      return { error: `invalid path ${file.path}: ${(e as Error).message}`, sha: '', success: false };
    }
    const sha = await existingSha(cfg, url, branch, doFetch);
    const body: Record<string, unknown> = {
      branch,
      content: Buffer.from(file.content).toString('base64'),
      message,
    };
    if (sha) body.sha = sha;

    let resp: Response;
    try {
      resp = await doFetch(url, {
        body: JSON.stringify(body),
        headers: headers(cfg, true),
        method: 'PUT',
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      // Síť / SSRF guard / timeout — přiznat, nespadnout celou routou.
      return { error: `PUT ${file.path} failed: ${(e as Error).message}`, sha: '', success: false };
    }
    if (!resp.ok) {
      return { error: `PUT ${file.path} → HTTP ${resp.status}`, sha: '', success: false };
    }
    const result = (await resp.json()) as { commit?: { sha?: string }; content?: { sha?: string } };
    lastSha = result.commit?.sha ?? result.content?.sha ?? '';
  }
  return { sha: lastSha, success: true };
}
