/**
 * Shared shape for AITG runtime probes.
 *
 * A probe takes a payload + model, dispatches an LLM call through
 * svc-ai-chat, runs the classifier, records the run. Every probe shares
 * 95% of the boilerplate — this helper centralises it so each new probe
 * file is ~30 lines instead of ~80.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  createAitgRunner,
  type AitgTrigger,
  type AitgSeverity,
} from '@aisha/aitg';
import {
  validateBody,
  toPublicError,
  createSafeLogger,
} from '@aisha/security';
import { config } from '../config.js';
import { verifyToken } from '../auth.js';
import { dispatchProbeChat } from './llmDispatch.js';

export interface ProbeClassification {
  status: 'passed' | 'failed' | 'flaky' | 'blocked' | 'not_applicable';
  severity: AitgSeverity;
  observed: Record<string, unknown>;
}

export interface ProbeDefinition {
  /** AITG test id, e.g. AITG-APP-02. */
  testId: string;
  /** Route path, e.g. /probes/app-02-indirect-injection. */
  path: string;
  /** System prompt used for the probe call. */
  systemPrompt: string;
  /** Build the user message from the payload + canary (if any). */
  buildUserMessage(payload: string): string;
  /** Run classifier on the LLM response and decide pass/fail. */
  classify(text: string): ProbeClassification;
}

const runner = createAitgRunner({
  postgrestUrl: config.postgrestUrl,
  serviceToken: config.postgrestServiceToken,
  service: 'svc-aitg-probes',
});

const baseSchema = z.object({
  payload: z.string().min(1),
  model: z.string().default(config.defaultModel),
  triggeredBy: z.enum(['pr-gate', 'nightly', 'manual', 'sentinel', 'self']).default('manual'),
});

/**
 * Register a probe route. Each probe is identical except for the
 * system-prompt + classifier — the rest (auth, Zod, dispatch, record_run,
 * error handling) lives here.
 */
export function registerProbe(app: FastifyInstance, def: ProbeDefinition): void {
  const log = createSafeLogger(`svc-aitg-probes:${def.testId.toLowerCase()}`);

  app.post(def.path, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      verifyToken(req.headers.authorization);
      const body = validateBody(baseSchema, req.body);
      const model = body.model ?? config.defaultModel;

      const chat = await dispatchProbeChat({
        model,
        systemPrompt: def.systemPrompt,
        userMessage: def.buildUserMessage(body.payload),
      });

      const verdict = def.classify(chat.text);
      const runId = await runner.record({
        testId: def.testId,
        buildSha: config.buildSha,
        triggeredBy: body.triggeredBy as AitgTrigger,
        status: verdict.status,
        severity: verdict.severity,
        // /generate anchors the turn in `ai_runs`, which is stronger provenance
        // than the Langfuse trace the old /chat path returned — it is queryable
        // in our own DB and carries the model-pin audit alongside it.
        evidenceUri: chat.runId ? `aisha://ai-runs/${chat.runId}` : null,
        details: {
          model,
          response_snippet: chat.text.slice(0, 800),
          ...verdict.observed,
        },
      });

      log.safeInfo(`aitg.${def.testId}.recorded`, { runId, status: verdict.status });
      return reply.send({ runId, ...verdict });
    } catch (err) {
      const { statusCode, body } = toPublicError(err);
      log.safeError(`aitg.${def.testId}.failed`, err);
      return reply.code(statusCode).send(body);
    }
  });
}
