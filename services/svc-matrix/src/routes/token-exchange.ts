import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken } from '../auth.js';
import { resolveMatrixIdentity, MatrixIdentityError } from '../matrix-identity.js';

/**
 * Exchange a Keycloak JWT for a Matrix access token.
 * Creates Matrix account on first use via Synapse admin API.
 */
export async function tokenExchangeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/token-exchange', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await verifyToken(req.headers.authorization);

    try {
      const identity = await resolveMatrixIdentity(user);
      return reply.send({
        access_token: identity.accessToken,
        user_id: identity.matrixUserId,
        home_server: identity.homeServer,
      });
    } catch (err) {
      if (err instanceof MatrixIdentityError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });
}
