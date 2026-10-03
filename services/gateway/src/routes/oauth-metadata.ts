import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

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
};