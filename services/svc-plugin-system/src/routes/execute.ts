import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { resolvePlugin, validateCapabilities } from '../sandbox.js';
import { spustitPlugin } from '../beh-pluginu.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UrceniTenanta =
  | { ok: true; tenantId: string; jmenemJineho: boolean }
  | { ok: false; status: 400 | 403 | 503; error: string };

/**
 * Tenant, za kterého plugin poběží — z OVĚŘENÉ identity, ne z těla požadavku.
 *
 * ⛔ NAMĚŘENO 2026-09-16: `tenantId: body.tenant_id ?? ''` šlo rovnou do
 * sandboxu. Plugin ho čte jako `ctx.tenant.id` a posílá do RPC (partner-metrics:
 * `p_partner_id: ctx.tenant.id`), které broker volá SE SLUŽEBNÍ ROLÍ. Tenanta tedy
 * určoval volající — kdokoli s tokenem realmu mohl spustit plugin nad daty cizího
 * tenanta.
 *
 * Pravidlo je TÉŽ, jaké platforma v DB už vynucuje nad tenantskými daty pluginů
 * (`get_available_plugins`, RLS `plugin_tenant_overrides`): tenant je uživatel
 * sám (`tenant_id = auth.uid()`); cizího smí jmenovat jen admin/staff. Kdo je
 * admin/staff, rozhoduje DB (`is_admin_or_staff` nad `user_roles`), ne realm
 * role v JWT — druhý zdroj téže pravdy by se s tím prvním rozešel.
 * Nedostupné ověření = odmítnutí (fail-closed), nikdy „pusť".
 */
export async function urcitTenanta(userId: string, pozadovany: unknown): Promise<UrceniTenanta> {
  if (pozadovany === undefined || pozadovany === null || pozadovany === '') {
    return { ok: true, tenantId: userId, jmenemJineho: false };
  }
  if (typeof pozadovany !== 'string' || !UUID_RE.test(pozadovany)) {
    return { ok: false, status: 400, error: 'tenant_id must be a UUID' };
  }
  if (pozadovany.toLowerCase() === userId.toLowerCase()) {
    return { ok: true, tenantId: userId, jmenemJineho: false };
  }
  let smi: unknown;
  try {
    smi = await rpcService<boolean>('is_admin_or_staff', { p_user_id: userId });
  } catch {
    return { ok: false, status: 503, error: 'tenant authorization unavailable' };
  }
  if (smi !== true) {
    return { ok: false, status: 403, error: "running a plugin for another tenant requires admin or staff" };
  }
  return { ok: true, tenantId: pozadovany, jmenemJineho: true };
}

/**
 * Plugin host — execute AISHA plugins in a sandboxed context.
 */
export async function pluginHostRoutes(app: FastifyInstance): Promise<void> {
  app.post('/execute', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await verifyToken(req.headers.authorization);

    const body = req.body as {
      plugin_slug?: string;
      action?: string;
      params?: Record<string, unknown>;
      required_capabilities?: string[];
      /** Tenant to attribute the run to — see runPluginInSandbox.tenantId. */
      tenant_id?: string;
    } | null;

    if (!body?.plugin_slug) {
      return reply.status(400).send({ error: 'plugin_slug is required' });
    }

    const tenant = await urcitTenanta(user.userId, body.tenant_id);
    if (!tenant.ok) {
      return reply.status(tenant.status).send({ error: tenant.error });
    }

    // Resolve plugin from registry
    const plugin = await resolvePlugin(body.plugin_slug);
    if (!plugin) {
      return reply.status(404).send({ error: 'Plugin not found or inactive' });
    }

    // ⛔ NAMĚŘENO 2026-09-16: `action` se proti manifestu nekontrolovala
    // (`body.action ?? 'default'`) a jediná kontrola capabilities běžela nad
    // seznamem, který poslal SÁM volající. Plugin dispatchuje podle akce na
    // deklarovanou capability (`handle(ctx, 'cron.sync_rides')`), takže akce MUSÍ
    // být capability z manifestu — jinak volající určuje, co plugin udělá.
    const action = typeof body.action === 'string' ? body.action : '';
    if (!action) {
      return reply.status(400).send({ error: 'action is required — a capability declared in the plugin manifest' });
    }
    if (!validateCapabilities(plugin.capabilities, [action])) {
      return reply.status(403).send({ error: 'action is not a capability declared by this plugin' });
    }
    // Manifest říká, co plugin UMÍ; zdroj dat, co SMÍ (2026-09-24). Plugin napojený
    // na zdroj smí jen schopnost, kterou AKTIVNÍ zdroj povolil (granted_capabilities) —
    // jinak by ruční běh obešel rozhodnutí majitele, které plánovač už respektuje.
    // Nedostupná kontrola = odmítnutí (fail-closed), nikdy „pusť".
    let smi: boolean;
    try {
      smi = (await rpcService<boolean>('plugin_capability_allowed', { p_capability: action, p_plugin_id: plugin.id })) === true;
    } catch {
      return reply.status(503).send({ error: 'Capability grant check unavailable' });
    }
    if (!smi) {
      return reply.status(403).send({ error: 'capability is not granted by the data source, or the source is inactive' });
    }

    // Validate capabilities (caller-declared requirements — an extra filter, not authorization)
    if (body.required_capabilities?.length) {
      if (!validateCapabilities(plugin.capabilities, body.required_capabilities)) {
        return reply.status(403).send({ error: 'Plugin lacks required capabilities' });
      }
    }

    const beh = await spustitPlugin(
      {
        plugin,
        action,
        params: body.params ?? {},
        tenantId: tenant.tenantId,
        userId: user.userId,
        jmenemJineho: tenant.jmenemJineho,
        zdroj: 'http',
      },
      app.log,
    );
    if (!beh.ok) {
      return reply.status(beh.status).send(beh.body);
    }
    return reply.send({ result: beh.result, logs: beh.logs });
  });
}
