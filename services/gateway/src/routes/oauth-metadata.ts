import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { CESTA_METADAT_SERVERU_ZNALOSTI, adresaServeruZnalosti } from '../lib/chraneny-zdroj.js';

function originOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return rawUrl.replace(/\/+$/, '');
  }
}

export const oauthMetadataRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/.well-known/oauth-protected-resource', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.type('application/json').send({
      resource: originOf(config.publicUrl),
      authorization_servers: [config.kcIssuer],
      bearer_methods_supported: ['header'],
      scopes_supported: ['openid', 'email', 'profile'],
      resource_name: 'AISHA API Gateway',
    });
  });

  /**
   * Metadata chráněného zdroje PRO SERVER ZNALOSTÍ (MCP) — RFC 9728 §3.1: cesta zdroje se
   * vkládá za kořen metadat. Sem ukazuje výzva k přihlášení, kterou proxy přidá k 401
   * z koncového bodu serveru znalostí (routes/functions.ts).
   *
   * `resource` je adresa KONCOVÉHO BODU, ne origin gatewaye: klient ji srovnává s adresou,
   * na kterou se připojuje. Dokument na kořeni výš popisuje gateway jako celek a zůstává,
   * jak byl. Rozsahy jsou tytéž — jsou to výchozí rozsahy klientů realmu.
   *
   * Bez veřejné adresy gatewaye se dokument NEVYDÁ (503 s důvodem): `resource` bez adresy
   * by byl výmysl. Výzva k přihlášení se v tom stavu neposílá, takže sem klienta nic nevede.
   */
  app.get(CESTA_METADAT_SERVERU_ZNALOSTI, async (_req: FastifyRequest, reply: FastifyReply) => {
    const resource = adresaServeruZnalosti(config.publicUrl);
    if (!resource) {
      return reply.status(503).send({
        error: 'resource_metadata_unavailable',
        message:
          'Veřejná adresa gatewaye není nastavená, nebo z ní nejde složit adresu zdroje ' +
          '(PUBLIC_URL / API_DOMAIN_PUBLIC) — metadata chráněného zdroje se nehádají.',
      });
    }
    return reply.type('application/json').send({
      resource,
      authorization_servers: [config.kcIssuer],
      bearer_methods_supported: ['header'],
      scopes_supported: ['openid', 'email', 'profile'],
      resource_name: 'AISHA Knowledge MCP Server',
    });
  });
};
