import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { createSsrfGuard } from '@aisha/security';

/**
 * /source/* — governed proxy to svc-source-broker's live source-read routes
 * (decision C: the extranet cockpit reads SOURCE data through the AISHA gateway,
 * never a second raw client to the source API).
 *
 * AuthN: the caller (Appsmith cockpit datasource) presents X-Intranet-Api-Key.
 * We forward to the broker as `Authorization: Bearer <INTRANET_API_KEY>`, which
 * the broker's requireAdminOrService guard accepts on its service-token path.
 * Only the three read routes the source adapter implements are proxied
 * (kpi / engagement / member) — never an arbitrary broker path.
 */
const INTRANET_API_KEY = process.env.INTRANET_API_KEY ?? '';
// Žádný fallback: source-broker je opt-in (`provision_when_env` v katalogu), takže
// když ho topologie nevydala, ten kontejner NEEXISTUJE. Dosazené jméno by z
// „pruh není zapojen" udělalo chybu spojení — odpověď, která míří jinam než příčina.
// Prázdno je legitimní stav a routy na něj odpovídají 501 not_configured.
const BROKER_URL = (process.env.SOURCE_BROKER_URL || '').replace(/\/$/, '');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * OWASP A10 — outbound calls go through the SSRF guard, never bare `fetch`.
 *
 * The allowlist is derived from the OPERATOR-configured SOURCE_BROKER_URL, so no
 * request input can ever widen it. `allowInternalNetworks` is on because the
 * broker is an in-cluster service on the private compose network (an RFC1918 /
 * container-bridge address, which the guard blocks by default), and `http:` is
 * allowed for the same reason — this hop never leaves the internal network.
 * A malformed SOURCE_BROKER_URL yields an empty allowlist, so every proxied call
 * fails closed at the guard rather than resolving somewhere unintended.
 */
const brokerHost = (() => {
  try {
    return new URL(BROKER_URL).hostname.toLowerCase();
  } catch {
    return '';
  }
})();

const ssrf = createSsrfGuard({
  service: 'gateway:source-proxy',
  hostAllowlist: brokerHost ? [brokerHost] : [],
  allowedSchemes: ['http:', 'https:'],
  allowInternalNetworks: true,
});

function authorized(req: FastifyRequest): boolean {
  if (!INTRANET_API_KEY) return false;
  const key = req.headers['x-intranet-api-key'];
  return typeof key === 'string' && key === INTRANET_API_KEY;
}

async function proxyGet(brokerPath: string, req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  // Nenakonfigurováno ≠ rozbito. Bez SOURCE_BROKER_URL federační pruh na téhle
  // instalaci prostě není zapojený — to je legitimní stav (broker je opt-in přes
  // `provision_when_env`), a odpověď na něj musí být 501, ne pád na spojení do
  // neexistujícího kontejneru. Kontrola je PŘED autorizací záměrně: kdo se ptá na
  // neexistující povrch, nemá se dozvědět nic o klíči.
  if (!BROKER_URL) return reply.code(501).send({ error: 'not_configured' });
  if (!authorized(req)) return reply.code(401).send({ error: 'unauthorized' });
  try {
    const upstream = await ssrf.safeFetch(`${BROKER_URL}${brokerPath}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${INTRANET_API_KEY}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await upstream.text();
    return reply
      .code(upstream.status)
      .header('content-type', upstream.headers.get('content-type') ?? 'application/json')
      .send(body);
  } catch (err) {
    req.log.error({ err, brokerPath }, 'source proxy: broker unreachable');
    return reply.code(502).send({ error: 'source_broker_unreachable' });
  }
}

export const sourceRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { storyId: string } }>('/:storyId/kpi', async (req, reply) => {
    const { storyId } = req.params;
    if (!UUID_RE.test(storyId)) return reply.code(400).send({ error: 'invalid_story_id' });
    return proxyGet(`/source/${storyId}/kpi`, req, reply);
  });

  app.get<{ Params: { storyId: string; userId: string } }>(
    '/:storyId/engagement/:userId',
    async (req, reply) => {
      const { storyId, userId } = req.params;
      if (!UUID_RE.test(storyId) || !UUID_RE.test(userId)) return reply.code(400).send({ error: 'invalid_id' });
      return proxyGet(`/source/${storyId}/engagement/${userId}`, req, reply);
    },
  );

  app.get<{ Params: { storyId: string; memberId: string } }>(
    '/:storyId/member/:memberId',
    async (req, reply) => {
      const { storyId, memberId } = req.params;
      if (!UUID_RE.test(storyId)) return reply.code(400).send({ error: 'invalid_story_id' });
      return proxyGet(`/source/${storyId}/member/${memberId}`, req, reply);
    },
  );
};
