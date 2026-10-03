import { config } from './config.js';

interface GovernedLlmInput {
  maxTokens?: number;
  model?: string;
  pluginSlug: string;
  prompt: string;
  userId: string;
}

interface GenerateResponse {
  text?: unknown;
}

function assertServiceToken(): string {
  if (!config.postgrestServiceToken) {
    throw Object.assign(
      new Error('POSTGREST_SERVICE_TOKEN is required to call the governed LLM router'),
      { statusCode: 503 },
    );
  }
  return config.postgrestServiceToken;
}

export async function callGovernedLlm(input: GovernedLlmInput): Promise<string> {
  const serviceToken = assertServiceToken();
  const response = await fetch(config.aiGenerateUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceToken}`,
    },
    body: JSON.stringify({
      task_kind: 'chat',
      risk_profile: 'low',
      constraints: {
        source: 'plugin_sandbox',
        plugin_slug: input.pluginSlug,
        requested_model: input.model ?? null,
      },
      messages: [{ role: 'user', content: input.prompt }],
      max_tokens: input.maxTokens ?? 1000,
      metadata: {
        source: 'plugin_sandbox',
        plugin_slug: input.pluginSlug,
        user_id: input.userId,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw Object.assign(
      new Error(`AISHA LLM router error: ${response.status}`),
      { statusCode: 502 },
    );
  }

  const data = await response.json() as GenerateResponse;
  return typeof data.text === 'string' ? data.text : '';
}
