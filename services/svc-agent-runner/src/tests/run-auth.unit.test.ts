/**
 * Pověření CLI běhu se čtou V OKAMŽIKU BĚHU z trezoru instance (čtečka pověření),
 * podle toho, co deklaruje runtime běhu (cli:<slug> → credential_env_var):
 *   - claude-cli: token předplatného (AGENT_CLAUDE_OAUTH_TOKEN) do kontejneru jako
 *     CLAUDE_CODE_OAUTH_TOKEN; ANTHROPIC_API_KEY jen v režimu api_key,
 *   - codex-cli: OPENAI_API_KEY pod svým jménem; chybí → běh neodstartuje,
 *   - změna v trezoru platí pro další běh (žádná hodnota z načtení configu).
 * Hodnoty jsou sentinely.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { katalogRuntime, trezor } = vi.hoisted(() => ({
  katalogRuntime: new Map<string, string>(),
  trezor: new Map<string, string>(),
}));

vi.mock('../config.js', () => ({
  config: {
    claudePermissionMode: 'acceptEdits',
    agentGitPush: false,
    agentGatewayUrl: '',
    agentMcpToken: '',
    agentGitRemote: '',
    agentGitToken: '',
    netbirdEnabled: false,
    netbirdApiUrl: '',
    claudeHomeHostPath: '',
    localLlmBaseUrl: '',
    localLlmModel: '',
    agentAuthMode: 'auto',
    anthropicBaseUrl: '',
    claudeModel: '',
    dockerApiVersion: 'v1.46',
  },
}));
vi.mock('../credentials.js', () => ({
  credentialNameForRuntime: async (slug: string) => katalogRuntime.get(slug) ?? null,
  credentials: {
    getMany: async (jmena: string[]) => Object.fromEntries(jmena.map((j) => [j, trezor.get(j) ?? null])),
  },
}));
vi.mock('../backends/docker-http.js', () => ({ dockerJSON: vi.fn(), dockerRequest: vi.fn(), dockerStart: vi.fn() }));
vi.mock('../backends/image-guard.js', () => ({ assertImageAllowed: vi.fn() }));

import { buildEnvAndBinds, resolveRunAuth } from '../backends/claude-cli.js';
import type { RunInput } from '../backends/index.js';

const vstup = (inputs: Record<string, unknown>): RunInput =>
  ({
    runId: 'run-1',
    kind: 'claude_cli_task',
    image: 'agent',
    brokerToken: 'broker',
    brokerUrl: 'http://broker',
    payload: {},
    timeoutMs: 1000,
    inputs,
  }) as unknown as RunInput;

const hodnotaV = (env: string[], jmeno: string) => env.find((e) => e.startsWith(`${jmeno}=`))?.slice(jmeno.length + 1);

beforeEach(() => {
  katalogRuntime.clear();
  trezor.clear();
  katalogRuntime.set('cli:claude-cli', 'AGENT_CLAUDE_OAUTH_TOKEN');
  katalogRuntime.set('cli:codex-cli', 'OPENAI_API_KEY');
});

describe('pověření CLI běhu z trezoru instance', () => {
  it('claude-cli: token předplatného z trezoru → CLAUDE_CODE_OAUTH_TOKEN, API klíč se nepředá', async () => {
    trezor.set('AGENT_CLAUDE_OAUTH_TOKEN', 'SENTINEL-oauth-1');
    trezor.set('ANTHROPIC_API_KEY', 'SENTINEL-anthropic-1');
    const auth = await resolveRunAuth({ cli_slug: 'claude-cli', prompt: 'x' });
    const { env } = buildEnvAndBinds(vstup({ prompt: 'x' }), 'x', 'b', auth, { brokerUrl: 'http://broker', proxyUrl: 'http://proxy' });
    expect(hodnotaV(env, 'CLAUDE_CODE_OAUTH_TOKEN')).toBe('SENTINEL-oauth-1');
    expect(hodnotaV(env, 'ANTHROPIC_API_KEY')).toBeUndefined();
    expect(hodnotaV(env, 'AGENT_CLAUDE_OAUTH_TOKEN')).toBeUndefined();
  });

  it('claude-cli bez tokenu (a bez mountu, bez lokálního LLM) → ANTHROPIC_API_KEY z trezoru', async () => {
    trezor.set('ANTHROPIC_API_KEY', 'SENTINEL-anthropic-2');
    const auth = await resolveRunAuth({ cli_slug: 'claude-cli' });
    const { env } = buildEnvAndBinds(vstup({}), 'x', 'b', auth, { brokerUrl: 'http://broker', proxyUrl: 'http://proxy' });
    expect(hodnotaV(env, 'ANTHROPIC_API_KEY')).toBe('SENTINEL-anthropic-2');
    expect(hodnotaV(env, 'CLAUDE_CODE_OAUTH_TOKEN')).toBeUndefined();
  });

  it('token vyměněný v trezoru platí pro DALŠÍ běh (čte se při běhu, ne při startu)', async () => {
    trezor.set('AGENT_CLAUDE_OAUTH_TOKEN', 'SENTINEL-stary');
    const prvni = buildEnvAndBinds(vstup({}), 'x', 'b', await resolveRunAuth({}), { brokerUrl: 'http://broker', proxyUrl: 'http://proxy' });
    trezor.set('AGENT_CLAUDE_OAUTH_TOKEN', 'SENTINEL-novy');
    const druhy = buildEnvAndBinds(vstup({}), 'x', 'b', await resolveRunAuth({}), { brokerUrl: 'http://broker', proxyUrl: 'http://proxy' });
    expect(hodnotaV(prvni.env, 'CLAUDE_CODE_OAUTH_TOKEN')).toBe('SENTINEL-stary');
    expect(hodnotaV(druhy.env, 'CLAUDE_CODE_OAUTH_TOKEN')).toBe('SENTINEL-novy');
  });

  it('běh bez cli_slug (zařazený před změnou) = výchozí slug fn_spawn → claude-cli', async () => {
    trezor.set('AGENT_CLAUDE_OAUTH_TOKEN', 'SENTINEL-oauth-3');
    const auth = await resolveRunAuth({ prompt: 'x' });
    expect(auth.cliSlug).toBe('claude-cli');
    expect(auth.runtimeCredentialName).toBe('AGENT_CLAUDE_OAUTH_TOKEN');
  });

  it('codex-cli: OPENAI_API_KEY pod svým jménem; žádný token Claude ani klíč Anthropic', async () => {
    trezor.set('OPENAI_API_KEY', 'SENTINEL-openai-1');
    trezor.set('AGENT_CLAUDE_OAUTH_TOKEN', 'SENTINEL-oauth-nesmi');
    trezor.set('ANTHROPIC_API_KEY', 'SENTINEL-anthropic-nesmi');
    const auth = await resolveRunAuth({ cli_slug: 'codex-cli' });
    const { env } = buildEnvAndBinds(vstup({ cli_slug: 'codex-cli' }), 'x', 'b', auth, { brokerUrl: 'http://broker', proxyUrl: 'http://proxy' });
    expect(hodnotaV(env, 'OPENAI_API_KEY')).toBe('SENTINEL-openai-1');
    expect(env.join('\n')).not.toContain('SENTINEL-oauth-nesmi');
    expect(env.join('\n')).not.toContain('SENTINEL-anthropic-nesmi');
  });

  it('codex-cli bez nastaveného OPENAI_API_KEY → běh neodstartuje, hláška říká co a kde (bez hodnot)', async () => {
    const auth = await resolveRunAuth({ cli_slug: 'codex-cli' });
    expect(() => buildEnvAndBinds(vstup({ cli_slug: 'codex-cli' }), 'x', 'b', auth, { brokerUrl: 'http://broker', proxyUrl: 'http://proxy' })).toThrow(
      /OPENAI_API_KEY pro cli:codex-cli není nastavené — nastavte ho v administraci/,
    );
  });
});
