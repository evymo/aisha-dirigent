/**
 * GET /resources/{resource_type}/?project_id=...&resource_id=...&source_type=...
 *
 * Maestro fetchuje různé resources z Kronosu — typicky `dialogue_fsm` (state
 * machine pro dialog flow) a další (system_prompt, glossary atd.). Pro AISHA
 * default deployment používáme **minimální FSM stub**: greeting → query → response,
 * který Maestru umožní fungovat bez plné Alquist FSM definice.
 *
 * Pokud bude kdykoli potřeba dodat skutečný FSM, doplníme čtení z AISHA
 * `agent_configurations` table (RPC `mcp_get_agent_configuration`) — zatím
 * návrat statického stubu pokrývá USP scenario (multi-turn dialog).
 */
import type { FastifyInstance } from 'fastify';
import { verifyKronosApiKey, AuthError } from '../auth.js';

// Minimal Dialogue FSM per Maestro Pydantic schema (packages/insight/common/
// common/models/fsm.py:Dialogue). State 0 = greeting → State 1 = RAG query loop.
// Skutečnou logiku dialog state machine řeší Maestro internally; shim jen vrátí
// platný FSM schema, aby Maestro mohl session_id reuse pro multi-turn coherence.
const MINIMAL_DIALOGUE_FSM = {
  dialogue_id: 1,
  dialogue_name: 'aisha-default-dialog',
  dialogue_author: 'aisha-kronos-shim',
  dialogue_description: 'Minimální dialog FSM pro AISHA Insight integraci — RAG-driven multi-turn',
  commands: [],
  states: [
    {
      state_id: 0,
      command: {
        type: 'display_text',
        next_state: 1,
        text: '',
      },
      unique_user_id: '',
      unique_session_token: '',
    },
    {
      state_id: 1,
      command: {
        type: 'get_rag',
        next_state: 1,
        text: '',
        streaming: true,
        top_n_buttons_enabled: false,
        top_n_count: 5,
      },
      unique_user_id: '',
      unique_session_token: '',
    },
  ],
  editor_active: false,
  editor_initial_file: '',
  language: 'cs-CZ',
};

const SYSTEM_PROMPT_STUB = `Jsi AISHA dialog asistent. Odpovídej jasně, věcně,
v souladu s Tao governance principy (warmth floor, no-punitivity).
Použij retrieval kontext z knowledge base pro factual odpovědi.`;

export async function resourcesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { resource_type: string };
    Querystring: { project_id?: string; resource_id?: string; source_type?: string };
  }>('/resources/:resource_type/', async (req, reply) => {
    try {
      verifyKronosApiKey(req.headers);
    } catch (err) {
      const status = err instanceof AuthError ? err.statusCode : 401;
      return reply.code(status).send({ detail: err instanceof Error ? err.message : 'Unauthorized' });
    }

    const resourceType = req.params.resource_type.toLowerCase();

    switch (resourceType) {
      case 'dialogue_fsm':
        return reply
          .header('Content-Type', 'application/json')
          .send(MINIMAL_DIALOGUE_FSM);

      case 'system_prompt':
      case 'persona_prompt':
        return reply
          .header('Content-Type', 'text/plain; charset=utf-8')
          .send(SYSTEM_PROMPT_STUB);

      case 'glossary':
      case 'synonyms':
      case 'banned_words':
        return reply
          .header('Content-Type', 'application/json')
          .send([]);

      default:
        return reply.code(404).send({
          detail: `Resource type '${resourceType}' není ve shim implementován. ` +
            'Pro plný Kronos resource API doplň mapping v aisha/db/sql/functions/.',
        });
    }
  });
}
