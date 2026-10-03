import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { prodluzNajem } from '../lib/najem-adresy.js';
import httpProxy from '@fastify/http-proxy';
import { config } from '../config.js';
import { translateAuthorizationForPostgrest } from '../auth/postgrest-jwt.js';

/**
 * /rest/v1/* → PostgREST proxy
 *
 * Strips the /rest/v1 prefix and forwards to PostgREST.
 * Keycloak RS256 tokens are verified at the gateway and translated to short
 * HS256 PostgREST JWTs carrying the same user/role claims.
 *
 * Backward compat: accepts both Authorization header and apikey header.
 * If apikey is present (Supabase SDK pattern), it's passed through as-is
 * since PostgREST ignores it — auth is via Authorization: Bearer <jwt>.
 */
export const restProxy: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Note: outer plugin is registered with prefix '/rest/v1' in server.ts,
  // so we must NOT set another prefix here — Fastify would compound them
  // to '/rest/v1/rest/v1/*'. rewritePrefix strips the inherited prefix
  // before forwarding to PostgREST.
  await app.register(httpProxy, {
    upstream: config.postgrestUrl,
    rewritePrefix: '/',
    http2: false,
    proxyPayloads: true,
    preHandler: async (req: FastifyRequest, reply: FastifyReply) => {
      // Log proxied RPC calls for observability
      if (req.url.includes('/rpc/')) {
        req.log.info({ url: req.url, method: req.method }, 'PostgREST RPC proxy');
      }

      const translated = await translateAuthorizationForPostgrest(req.headers.authorization);
      if (!translated.ok) {
        return reply.code(translated.status).send({ error: translated.error });
      }

      if (translated.translated) {
        (req.headers as Record<string, string | string[] | undefined>).authorization = translated.authorization;
        // Ověřený Keycloak token = přihlášený uživatel. Nájem jeho adresy se
        // tím prodlužuje, aby mu dveře nezhasly uprostřed práce. Fire-and-forget
        // a škrceno — nájem je VEDLEJŠÍ ÚČINEK ověření, ne jeho podmínka.
        prodluzNajem(config.knockUrl, req.headers['x-forwarded-for'] as string | undefined);
      }
    },
  });
};
