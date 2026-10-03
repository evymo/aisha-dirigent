/**
 * ACS structured generation (IP-1): the model fills a contract, it does not
 * write prose (R1). STATIC llmRouter dependency — import this module only from
 * call sites that already sit on the LLM path (never from toolExecutor).
 */
import { createSafeLogger } from '@aisha/security';
import { validatePayload } from '@aisha/acs-sdk';
import type { SchemaRef } from '@aisha/acs-contracts';
import { unifiedChat, type LlmProvider } from '../llmRouter.js';
import { journalDispatch } from '../dispatchJournal.js';

const log = createSafeLogger('acs-generation');

export class AcsGenerationError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly lastDetail: string,
  ) {
    super(message);
    this.name = 'AcsGenerationError';
  }
}

export interface StructuredChatInput {
  provider: LlmProvider;
  model: string;
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  schemaRef: SchemaRef;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number; // bounded, max 2 (IP-1)
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/m.exec(trimmed);
  return JSON.parse(fenced ? fenced[1].trim() : trimmed);
}

export async function acsStructuredChat<T extends object>(input: StructuredChatInput): Promise<T> {
  const retries = Math.min(input.maxRetries ?? 2, 2);
  let lastDetail = '';

  // I1 "no dispatch without a journaled decision": acsStructuredChat is a
  // model-override site (the caller picks provider+model), so mint the
  // ai_decisions row before the raw unifiedChat. Fail-closed — journalDispatch
  // throws if the durable row can't be written, so no dispatch proceeds
  // unjournaled. The bounded retries below re-attempt the SAME decision.
  await journalDispatch({
    model: input.model,
    provider: input.provider,
    reason: `acs.structured-generation:${input.schemaRef}`,
  });

  for (let attempt = 0; attempt <= retries; attempt++) {
    const constraint =
      `\n\nODPOVĚZ VÝHRADNĚ validním JSON objektem dle kontraktu ${input.schemaRef}. ` +
      `Žádný doprovodný text, žádné markdown fence.` +
      (attempt > 0 ? ` Předchozí pokus byl nevalidní: ${lastDetail.slice(0, 300)}` : '');
    // I1 "no dispatch without a journaled decision": acsStructuredChat is a
    // model-override site (the caller picks provider + model), so mint an
    // ai_decisions row before EACH raw dispatch — including retries, which are
    // real additional LLM calls. Fail-closed: journalDispatch throws if the row
    // cannot be persisted, so no unjournaled dispatch proceeds.
    await journalDispatch({
      model: input.model,
      provider: input.provider,
      reason: `acs.structured-generation:${input.schemaRef}`,
    });
    const result = await unifiedChat({
      provider: input.provider,
      model: input.model,
      systemPrompt: input.systemPrompt + constraint,
      messages: input.messages,
      temperature: input.temperature ?? 0,
      maxTokens: input.maxTokens ?? 2000,
    });
    try {
      const parsed = extractJson(result.text);
      const verdict = validatePayload(input.schemaRef, parsed);
      if (verdict.ok) return parsed as T;
      lastDetail = verdict.rejection.detail;
    } catch (err) {
      lastDetail = `json_parse: ${(err as Error).message}`;
    }
    log.safeWarn('ACS structured generation invalid', { attempt: attempt + 1, detail: lastDetail.slice(0, 200) });
  }

  throw new AcsGenerationError(
    `ACS: model failed to produce a valid ${input.schemaRef} payload after ${retries + 1} attempts`,
    retries + 1,
    lastDetail,
  );
}
