/**
 * v2 port: resolve the OpenAI API key (DB-backed first, env fallback).
 *
 * @module
 */
import type { PostgrestClient } from './deps.js';

export async function getOpenAiApiKey(client: PostgrestClient): Promise<string | null> {
  try {
    const { data } = await client.rpc<{ value: string | null }>('edge_app_secrets', {
      p_action: 'get',
      p_key: 'OPENAI_API_KEY',
    });
    if (data?.value) return data.value;
  } catch {
    // fall through to env
  }
  return process.env.OPENAI_API_KEY ?? null;
}
