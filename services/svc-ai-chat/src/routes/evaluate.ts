/**
 * POST /evaluate — LLM-as-judge evaluation of one assistant message (admin/staff or service).
 *
 * Logika hodnocení je v lib/messageEvaluation.ts (sdílí ji chat, který hodnotí vzorkovaně
 * v procesu). Tady jen autentizace, výběr modelu soudce a mapování výsledku na HTTP.
 * Dávkové hodnocení je zavřené — viz níže (SELF_IMPROVEMENT_LOOP.md K-17, M4).
 */
import type { FastifyInstance } from 'fastify';
import { verifyToken, verifyServiceRole, isAdminOrStaff, AuthError } from '../auth.js';
import { resolveAvailableModel } from '../lib/llmRouter.js';
import { resolveDefaultBackend } from '../lib/defaultModel.js';
import { evaluateChatMessage } from '../lib/messageEvaluation.js';

interface EvalBody {
  eval_run_id?: string;
  message_id?: string;
  model_override?: string;
}

export async function evaluateRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: EvalBody }>('/evaluate', async (req, reply) => {
    const authHeader = req.headers.authorization ?? '';

    // Služba napřed: služební token JE JWT („ey…"), dřív ho route podle prefixu poslala
    // na ověření uživatelského tokenu (Keycloak RS256) → 401 a služební cesta byla
    // nedosažitelná (K-17). Porovnání je konstantně-časové (@aisha/security).
    let isService = false;
    try {
      verifyServiceRole(authHeader);
      isService = true;
    } catch {
      isService = false;
    }
    if (!isService) {
      try {
        const user = await verifyToken(authHeader);
        if (!isAdminOrStaff(user)) {
          return reply.code(403).send({ error: 'Admin or staff required' });
        }
      } catch (err) {
        return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
      }
    }

    const { message_id, eval_run_id, model_override } = req.body ?? {};

    // Dávkové hodnocení — ZAVŘENO (SELF_IMPROVEMENT_LOOP.md K-17, M4).
    // Dávka posílala soudci ULOŽENOU zlatou odpověď, ne odpověď, kterou systém vyprodukuje
    // teď — o kvalitě AISHY neříkala nic, a přes fn_get_agent_performance_snapshot by
    // vydávala skóre zlatých odpovědí za kvalitu agenta. Navíc volala neexistující
    // get_golden_examples_for_eval a insert_eval_result s jinými parametry (chybu polykal
    // `.catch`). Poctivé dávkové hodnocení = runner Capability Gate nad ŽIVÝM výstupem.
    if (eval_run_id && !message_id) {
      return reply.code(501).send({
        error: 'batch_eval_not_available',
        reason: 'Batch evaluation judged stored golden answers, not live output; it returns with the capability gate runner (SELF_IMPROVEMENT_LOOP.md M4).',
        eval_run_id,
      });
    }

    if (!message_id) {
      return reply.code(400).send({ error: 'message_id is required' });
    }

    // Capability-availability dynamic selection: model a provider soudce z řádku resolveru;
    // remap přes resolveAvailableModel jen pro ručně psaný `model_override`
    // (⛔ NAMĚŘENO 2026-09-13: remap výchozího modelu ho tiše nahradil jiným providerem).
    const backend = model_override
      ? resolveAvailableModel(model_override)
      : await resolveDefaultBackend('evaluation');

    const outcome = await evaluateChatMessage(message_id, backend);
    switch (outcome.kind) {
      case 'ok':
        return reply.send({
          avg_score: outcome.avgScore,
          eval_model: outcome.model,
          message_id,
          scores: outcome.scores,
          tokens_used: outcome.tokensUsed,
        });
      case 'not_found':
        return reply.code(404).send({ error: 'Message not found' });
      case 'not_assistant':
        return reply.code(400).send({ error: 'Only assistant messages can be evaluated' });
      case 'invalid_scores':
        return reply.code(502).send({ error: 'Evaluator returned invalid scores', raw: outcome.raw });
      case 'not_persisted':
        req.log.error({ message_id, err: outcome.error }, 'evaluate: eval score not persisted');
        return reply.code(500).send({ error: 'Eval score not persisted', message_id });
    }
  });
}
