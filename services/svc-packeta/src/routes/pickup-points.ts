import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken } from '../auth.js';
import { getBranches, sortByDistance, calculateShippingCost } from '../packeta-feed.js';

/**
 * Pickup points — list branches/Z-BOXes near given coordinates.
 */
export async function pickupPointsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/pickup-points', async (req: FastifyRequest, reply: FastifyReply) => {
    await verifyToken(req.headers.authorization);

    const query = req.query as { lat?: string; lng?: string; limit?: string; country?: string; type?: string };

    const lat = query.lat ? parseFloat(query.lat) : undefined;
    const lng = query.lng ? parseFloat(query.lng) : undefined;
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 200);
    const country = query.country?.toLowerCase() ?? 'cz';
    const typeFilter = query.type as 'branch' | 'zbox' | undefined;

    let branches = await getBranches();

    // Filter by country
    branches = branches.filter((b) => b.country === country);

    // Filter by type
    if (typeFilter) {
      branches = branches.filter((b) => b.type === typeFilter);
    }

    // Sort by proximity if coordinates provided
    if (lat !== undefined && lng !== undefined && !isNaN(lat) && !isNaN(lng)) {
      const sorted = sortByDistance(branches, lat, lng).slice(0, limit);
      return reply.send({ points: sorted, total: sorted.length });
    }

    return reply.send({ points: branches.slice(0, limit), total: branches.length });
  });
}
