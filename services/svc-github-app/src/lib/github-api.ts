/**
 * GitHub API client — typed wrapper around fetch for GitHub REST API v3.
 */

const GITHUB_API = 'https://api.github.com';

export interface GitHubApiOptions {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  accept?: string;
}

export class GitHubApiError extends Error {
  status: number;
  responseData: unknown;

  constructor(status: number, data: unknown) {
    const message =
      typeof data === 'object' && data !== null && 'message' in (data as Record<string, unknown>)
        ? (data as Record<string, string>).message
        : `GitHub API error (${status})`;
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.responseData = data;
  }
}

/**
 * Make a GitHub API request with an installation token.
 */
export async function githubApi(
  token: string,
  options: GitHubApiOptions,
): Promise<{ status: number; data: unknown }> {
  const url = `${GITHUB_API}${options.path}`;

  const headers: Record<string, string> = {
    'Authorization': `token ${token}`,
    'Accept': options.accept ?? 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  const status = response.status;

  if (status === 204) {
    return { status, data: null };
  }

  let data: unknown;
  const contentType = response.headers.get('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (status >= 400) {
    throw new GitHubApiError(status, data);
  }

  return { status, data };
}
