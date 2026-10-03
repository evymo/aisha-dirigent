import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken } from '../auth.js';
import { getBranches, getCarriers, calculateShippingCost } from '../packeta-feed.js';
import { resolveBaseCurrency } from '../lib/currency.js';

/**
 * Available shipping methods — branches + Z-BOXes + carriers with cost calculation.
 */
export async function availableMethodsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/available-methods', async (req: FastifyRequest, reply: FastifyReply) => {
    await verifyToken(req.headers.authorization);

    const query = req.query as { country?: string; order_total?: string };
    const country = query.country?.toLowerCase() ?? 'cz';
    const orderTotal = parseFloat(query.order_total ?? '0');

    const [branches, carriers] = await Promise.all([getBranches(), getCarriers()]);

    const filteredBranches = branches.filter((b) => b.country === country);
    const filteredCarriers = carriers.filter((c) => c.country === country);

    const shippingCost = calculateShippingCost(orderTotal);
    const currency = await resolveBaseCurrency();

    return reply.send({
      pickup_points: {
        branches: filteredBranches.filter((b) => b.type === 'branch').length,
        zboxes: filteredBranches.filter((b) => b.type === 'zbox').length,
      },
      carriers: filteredCarriers.map((c) => ({
        id: c.id,
        name: c.name,
        max_weight_kg: c.maxWeight,
        pickup_points: c.pickupPoints,
      })),
      shipping_cost: shippingCost,
      free_shipping_from: shippingCost === 0 ? orderTotal : undefined,
      currency,
    });
  });
}
