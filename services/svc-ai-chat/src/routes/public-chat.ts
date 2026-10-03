/**
 * POST /public-chat — Stateless public chatbot entry (no auth).
 * Rate-limited per visitor_id. Forwards to n8n webhook.
 *
 * ⛔ NAMĚŘENO 2026-09-14: route ignorovala `{error}` z get_active_channel_config
 * a četla klíče, které funkce nevrací (`max_message_length`, `webhook_url`…),
 * takže anonymní vstup přeposílal do n8n i bez AKTIVNÍHO kanálu — s výchozími
 * limity. Vypnutý kanál tedy nic nezavíral. Teď fail-closed: bez aktivního
 * kanálu 404, bez limitů v `guardrails` 503. Instance, která anonymní chat
 * nechce, ho prostě nemá aktivní.
 *
 * OWASP AITG hardening: the n8n response runs through `withAitgGuard` for
 * AITG-APP-01 (prompt injection) and AITG-APP-12 (toxic output) before
 * leaving the service. Violations are recorded in `aitg_runs` and the
 * response is replaced by a safe refusal — the caller sees a generic
 * message rather than the unsafe model output.
 */
import type { FastifyInstance } from 'fastify';
import { withAitgGuardOrRefuse, createAitgRunner } from '@aisha/aitg';
import { rpcService } from '../postgrest.js';
import { config } from '../config.js';

const aitgRunner = createAitgRunner({
  postgrestUrl: config.postgrestUrl,
  serviceToken: config.postgrestServiceToken,
  service: 'svc-ai-chat:public-chat',
});

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

interface PublicChatBody {
  channel_slug?: string;
  language?: string;
  message: string;
  visitor_id: string;
}

/** Část výsledku get_active_channel_config, kterou route čte — jen klíče, které SQL opravdu vrací. */
interface ActiveChannelConfig {
  error?: string;
  guardrails?: { max_message_length?: unknown; rate_limit_per_minute?: unknown };
}

const jeKladneCislo = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export async function publicChatRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: PublicChatBody }>('/public-chat', async (req, reply) => {
    const { message, visitor_id, channel_slug, language } = req.body ?? {};

    if (!message || typeof message !== 'string') {
      return reply.code(400).send({ error: 'message is required' });
    }
    if (!visitor_id || typeof visitor_id !== 'string') {
      return reply.code(400).send({ error: 'visitor_id is required' });
    }

    // Anonymní vstup existuje jen pro AKTIVNÍ kanál — funkce jiný stav vrací jako `{error}`.
    const slug = channel_slug ?? 'public-chat';
    const channelConfig = await rpcService<ActiveChannelConfig | null>('get_active_channel_config', { p_channel_slug: slug });
    if (!channelConfig || channelConfig.error) {
      return reply.code(404).send({ error: 'Channel not available' });
    }

    const maxLen = channelConfig.guardrails?.max_message_length;
    const rateLimit = channelConfig.guardrails?.rate_limit_per_minute;
    if (!jeKladneCislo(maxLen) || !jeKladneCislo(rateLimit)) {
      return reply.code(503).send({ error: 'Channel misconfigured' });
    }

    if (message.length > maxLen) {
      return reply.code(400).send({ error: `Message exceeds ${maxLen} characters` });
    }

    // In-memory rate limiting per visitor
    const now = Date.now();
    const entry = rateLimitMap.get(visitor_id);
    if (entry && entry.resetAt > now) {
      if (entry.count >= rateLimit) {
        return reply.code(429).send({ error: 'Rate limit exceeded', retry_after_seconds: Math.ceil((entry.resetAt - now) / 1000) });
      }
      entry.count++;
    } else {
      rateLimitMap.set(visitor_id, { count: 1, resetAt: now + 60_000 });
    }

    // Periodic cleanup
    if (rateLimitMap.size > 10_000) {
      for (const [k, v] of rateLimitMap) {
        if (v.resetAt < now) rateLimitMap.delete(k);
      }
    }

    // Forward to the platform n8n webhook (WF_PUBLIC_CHATBOT). get_active_channel_config
    // nevrací `webhook_url`, cíl je proto jediný; SSRF guard zůstává jako obrana.
    const webhookUrl = `${config.n8nBaseUrl}/webhook/public-chat`;
    const { createSsrfGuard, parseHostAllowlist } = await import('@aisha/security');
    const guard = createSsrfGuard({
      service: 'svc-ai-chat',
      hostAllowlist: parseHostAllowlist(config.ssrfHostAllowlist),
      allowedSchemes: ['https:', 'http:'],
      allowInternalNetworks: true,
    });
    const resp = await guard.safeFetch(webhookUrl, {
      // WF_PUBLIC_CHATBOT čte kanál z `body.channel` — ověřený kanál musí být ten, který workflow použije.
      body: JSON.stringify({
        channel: slug,
        language: language ?? 'en',
        message,
        visitor_id,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      return reply.code(502).send({ error: 'Chat service temporarily unavailable' });
    }

    const data = await resp.json() as Record<string, unknown>;
    // OWASP AITG — guard against prompt-injection bleed-through and toxic
    // responses BEFORE the body leaves this service. n8n is treated as an
    // untrusted upstream for this purpose (it can return anything an attacker
    // crafted through the chat path).
    const responseText = String(data?.message ?? data?.text ?? data?.response ?? '');
    const guarded = await withAitgGuardOrRefuse(
      {
        runner: aitgRunner,
        buildSha: config.buildSha ?? 'dev',
        triggeredBy: 'self',
        enabled: ['AITG-APP-01', 'AITG-APP-12'],
        service: 'svc-ai-chat:public-chat',
      },
      async () => ({ text: responseText, raw: data }),
      { text: 'I cannot help with that request.', raw: { message: 'I cannot help with that request.' } },
    );
    if (guarded.violated) {
      return reply.send({ message: guarded.result.text, blocked: true });
    }
    return reply.send(data);
  });
}
