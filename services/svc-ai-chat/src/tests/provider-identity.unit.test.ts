/**
 * providerIdentity — provider modelu z ŘÁDKU registru/resolveru, nikdy z prefixu id.
 *
 * ⛔ NAMĚŘENO 2026-09-13: dispatch nad modelem z resolveru hádal providera
 * `resolveProvider(model_id)`; id bez prefixu (alias lokálního modelu, model za
 * llm_gateway) vyšlo `openai`. Tyhle případy drží, že převod čte jen slug a backend_kind.
 */
import { describe, expect, it } from 'vitest';
import { providerForRegistryRow, providerForResolvedBackend } from '../lib/providerIdentity.js';

describe('providerForResolvedBackend', () => {
  it('backend_kind transportu s jediným backendem v procesu rozhoduje první', () => {
    expect(providerForResolvedBackend({ backend_kind: 'local_vllm', provider_slug: 'bge_reranker_local' })).toBe('vllm');
    expect(providerForResolvedBackend({ backend_kind: 'local_ollama', provider_slug: 'ollama-local' })).toBe('ollama');
    expect(providerForResolvedBackend({ backend_kind: 'llm_gateway', provider_slug: 'llmgateway-io' })).toBe('gateway');
  });

  it('jinak slug nebo rodinný klíč registru (oba tvary)', () => {
    expect(providerForResolvedBackend({ backend_kind: 'direct_cloud', provider_slug: 'google-genai' })).toBe('google');
    expect(providerForResolvedBackend({ backend_kind: 'direct_cloud', provider_slug: 'xai' })).toBe('xai');
    expect(providerForResolvedBackend({ provider_slug: 'vllm-local' })).toBe('vllm');
    expect(providerForResolvedBackend({ provider_slug: 'anthropic' })).toBe('anthropic');
  });

  it('⛔ id modelu se nečte: řádek vllm s id, které vypadá jako OpenAI, zůstane vllm', () => {
    const row = { provider_slug: 'vllm-local', backend_kind: 'local_vllm', model_id: 'gpt-oss-20b' };
    expect(providerForResolvedBackend(row)).toBe('vllm');
  });

  it('⛔ negativní sonda: slug bez backendu v procesu, prázdný řádek → null (volající selže, nehádá)', () => {
    expect(providerForResolvedBackend({ backend_kind: 'direct_cloud', provider_slug: 'mistral' })).toBeNull();
    expect(providerForResolvedBackend({ backend_kind: 'direct_cloud' })).toBeNull();
    expect(providerForResolvedBackend({})).toBeNull();
    expect(providerForResolvedBackend(null)).toBeNull();
    expect(providerForResolvedBackend(undefined)).toBeNull();
  });
});

describe('providerForRegistryRow (přesunuto z llmRouter.ts, chování beze změny)', () => {
  it('rodinný klíč i slug', () => {
    expect(providerForRegistryRow('vllm')).toBe('vllm');
    expect(providerForRegistryRow(' VLLM-LOCAL ')).toBe('vllm');
    expect(providerForRegistryRow('llm-gateway')).toBe('gateway');
  });

  it('neznámý klíč → null', () => {
    expect(providerForRegistryRow('mlx')).toBeNull();
    expect(providerForRegistryRow('')).toBeNull();
  });
});
