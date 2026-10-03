/**
 * Sandbox broker routes — svc-plugin-system.
 *
 * The /sandbox/fetch endpoint forwards an HTTP request from a sandboxed
 * plugin to an external URL. Every URL the plugin passes is treated as
 * attacker-controlled — we wrap it in @aisha/security's SSRF guard which
 * enforces scheme + host + DNS-rebinding IP checks before letting the
 * request leave the box. For a plugin run (`plugin-exec`) the allowed hosts
 * and RPCs come from the plugin's APPROVED sandbox policy (manifest `sandbox`,
 * via get_plugin_sandbox_policy — see sandbox-politika.ts), optionally narrowed
 * by the instance env. Empty list => NO outbound calls / writes (default-deny).
 * Other run kinds keep the service env lists (PLUGIN_NETWORK_ALLOWLIST /
 * PLUGIN_RPC_WHITELIST) as before.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { jwtVerify } from 'jose';
import { createSsrfGuard, SsrfBlockedError } from '@aisha/security';
import { config } from '../config.js';
import { getBrokerSecretBytes } from '../broker-secret.js';
import { zalozitMetr, zaznamenatVolani, zaznamenatZapis } from '../mereni.js';
import { callGovernedLlm } from '../llm-router.js';
import { rpcSandboxed, rpcService } from '../postgrest.js';
import { politikaPluginu, zdrojSedi } from '../sandbox-politika.js';

interface BrokerTokenPayload {
  sub: string;
  kind: string;
  source_ref: string;
  user_id: string;
  /** Tenant běhu (plugin-exec) — autorizoval ho host; runner ho do tokenu propíše. */
  tenant_id?: string;
}

async function verifyBrokerToken(authHeader: string | undefined): Promise<BrokerTokenPayload> {
  if (!authHeader?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Missing broker token'), { statusCode: 401 });
  }
  const token = authHeader.slice(7);
  const { payload } = await jwtVerify(token, getBrokerSecretBytes(), { audience: 'aisha-plugin-broker' });
  return payload as unknown as BrokerTokenPayload;
}

export async function sandboxBrokerRoutes(app: FastifyInstance): Promise<void> {
  // ⛔ NAMĚŘENO 2026-09-16: plugin dostával `ctx.config = {}` (konfigurace jela
  // v PLUGIN_PAYLOAD, tedy v ENV kontejneru, kam pověření nesmí) a pověření zdroje
  // (set_data_source_secrets) nikdo nečetl — konektor neměl endpoint ani klíč.
  // Konfiguraci si teď shim vyzvedne TADY, na token svého běhu: plugin a tenant
  // se berou z TOKENU (vydal ho runner pro běh, který autorizoval host), nikdy
  // z těla požadavku. Odpověď nese tajemství — nelogovat.
  app.post('/sandbox/config', async (req: FastifyRequest, reply: FastifyReply) => {
    const bp = await verifyBrokerToken(req.headers.authorization).catch(() =>
      reply.status(401).send({ error: 'Invalid broker token' }),
    );
    if (!bp) return;
    if (bp.kind !== 'plugin-exec' || !bp.source_ref) {
      return reply.status(403).send({ error: 'Configuration is only issued to plugin-exec runs' });
    }
    // Shim si o konfiguraci řekne jako PRVNÍ — tady začíná měření běhu (sub = run_id).
    zalozitMetr(bp.sub);
    try {
      const konfigurace = await rpcService<Record<string, unknown>>('get_plugin_runtime_config', {
        p_plugin_slug: bp.source_ref,
        p_tenant_id: bp.tenant_id ? bp.tenant_id : null,
      });
      return reply.send(konfigurace && typeof konfigurace === 'object' ? konfigurace : {});
    } catch (err) {
      app.log.error({ plugin: bp.source_ref, error: err instanceof Error ? err.message : String(err) }, 'Plugin runtime config unavailable');
      return reply.status(503).send({ error: 'Plugin configuration unavailable' });
    }
  });

  app.post('/sandbox/rpc', async (req: FastifyRequest, reply: FastifyReply) => {
    const bp = await verifyBrokerToken(req.headers.authorization).catch(() =>
      reply.status(401).send({ error: 'Invalid broker token' }),
    );
    if (!bp) return;
    const body = req.body as { fn?: string; params?: Record<string, unknown> } | null;
    if (!body?.fn) return reply.status(400).send({ error: 'fn is required' });
    // Běh pluginu: povolená RPC jsou ta ze SCHVÁLENÉ sandbox politiky pluginu
    // (proměnná služby ji smí jen zúžit). Viz sandbox-politika.ts.
    if (bp.kind === 'plugin-exec' && bp.source_ref) {
      let politika: Awaited<ReturnType<typeof politikaPluginu>>;
      try {
        politika = await politikaPluginu(bp.source_ref);
      } catch (err) {
        app.log.error({ plugin: bp.source_ref, error: err instanceof Error ? err.message : String(err) }, 'Plugin sandbox policy unavailable');
        return reply.status(503).send({ error: 'Plugin sandbox policy unavailable' });
      }
      if (!politika.rpc.includes(body.fn)) {
        return reply.status(403).send({ error: `Plugin RPC call to '${body.fn}' is not in its approved sandbox policy` });
      }
      if (!zdrojSedi(politika, body.params ?? {})) {
        return reply.status(403).send({ error: `Plugin '${bp.source_ref}' may only write under its own source` });
      }
      try {
        const result = await rpcService(body.fn, body.params ?? {});
        zaznamenatZapis(bp.sub, body.fn, body.params ?? {});
        return reply.send(result);
      } catch (err) {
        return reply.status(403).send({ error: err instanceof Error ? err.message : 'RPC denied' });
      }
    }
    try {
      const result = await rpcSandboxed(body.fn, body.params ?? {});
      zaznamenatZapis(bp.sub, body.fn, body.params ?? {});
      return reply.send(result);
    } catch (err) {
      return reply.status(403).send({ error: err instanceof Error ? err.message : 'RPC denied' });
    }
  });

  app.post('/sandbox/kv/get', async (req: FastifyRequest, reply: FastifyReply) => {
    const bp = await verifyBrokerToken(req.headers.authorization).catch(() =>
      reply.status(401).send({ error: 'Invalid broker token' }),
    );
    if (!bp) return;
    const body = req.body as { key?: string } | null;
    if (!body?.key) return reply.status(400).send({ error: 'key is required' });
    const result = await rpcService('plugin_kv_get', { p_key: body.key, p_plugin: bp.source_ref });
    return reply.send(result);
  });

  app.post('/sandbox/kv/set', async (req: FastifyRequest, reply: FastifyReply) => {
    const bp = await verifyBrokerToken(req.headers.authorization).catch(() =>
      reply.status(401).send({ error: 'Invalid broker token' }),
    );
    if (!bp) return;
    const body = req.body as { key?: string; value?: unknown } | null;
    if (!body?.key) return reply.status(400).send({ error: 'key is required' });
    await rpcService('plugin_kv_set', { p_key: body.key, p_plugin: bp.source_ref, p_value: body.value });
    return reply.status(204).send();
  });

  app.post('/sandbox/kv/delete', async (req: FastifyRequest, reply: FastifyReply) => {
    const bp = await verifyBrokerToken(req.headers.authorization).catch(() =>
      reply.status(401).send({ error: 'Invalid broker token' }),
    );
    if (!bp) return;
    const body = req.body as { key?: string } | null;
    if (!body?.key) return reply.status(400).send({ error: 'key is required' });
    await rpcService('plugin_kv_delete', { p_key: body.key, p_plugin: bp.source_ref });
    return reply.status(204).send();
  });

  app.post('/sandbox/fetch', async (req: FastifyRequest, reply: FastifyReply) => {
    const bp = await verifyBrokerToken(req.headers.authorization).catch(() =>
      reply.status(401).send({ error: 'Invalid broker token' }),
    );
    if (!bp) return;
    const body = req.body as {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string | null;
      redirect?: unknown;
    } | null;
    if (!body?.url) return reply.status(400).send({ error: 'url is required' });
    // The plugin's `redirect` keeps its fetch meaning, but it is the SSRF guard
    // that enforces it — every mode goes through safeFetch, so no mode can skip
    // the per-hop allowlist/IP check or carry the plugin's headers/body to
    // another origin. Absent = fetch's own default 'follow' (what shim images
    // built before this field existed expect). Anything else is rejected.
    const redirect = body.redirect ?? 'follow';
    if (redirect !== 'follow' && redirect !== 'manual' && redirect !== 'error') {
      return reply.status(400).send({ error: "redirect must be 'follow', 'manual' or 'error'" });
    }

    // Běh pluginu: hostitelé ze SCHVÁLENÉ sandbox politiky pluginu (proměnná
    // služby ji smí jen zúžit); jiné druhy běhu dál proměnná služby.
    let hosty: string[];
    if (bp.kind === 'plugin-exec' && bp.source_ref) {
      try {
        hosty = (await politikaPluginu(bp.source_ref)).hosty;
      } catch (err) {
        app.log.error({ plugin: bp.source_ref, error: err instanceof Error ? err.message : String(err) }, 'Plugin sandbox policy unavailable');
        return reply.status(503).send({ error: 'Plugin sandbox policy unavailable' });
      }
    } else {
      hosty = config.networkAllowlist;
    }

    // Default-deny: empty allowlist => no outbound calls.
    if (hosty.length === 0) {
      return reply.status(403).send({ error: 'No network destinations are allowed for this plugin' });
    }

    const guard = createSsrfGuard({
      service: 'svc-plugin-system',
      hostAllowlist: hosty,
      allowedSchemes: ['https:'],
    });

    // Měří se KAŽDÉ volání — i zablokované a vypršelé (status null = chyba).
    const zacatek = performance.now();
    const odeslano = typeof body.body === 'string' ? Buffer.byteLength(body.body) : 0;
    let upstream: Response;
    try {
      upstream = await guard.safeFetch(body.url, {
        method: body.method ?? 'GET',
        headers: body.headers,
        body: body.body ?? undefined,
        redirect,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      zaznamenatVolani(bp.sub, body.url, performance.now() - zacatek, null, odeslano, 0);
      if (err instanceof SsrfBlockedError) {
        return reply.status(403).send({ error: `Network access blocked: ${err.reason}` });
      }
      throw err;
    }
    const responseBody = await upstream.text();
    zaznamenatVolani(bp.sub, body.url, performance.now() - zacatek, upstream.status, odeslano, Buffer.byteLength(responseBody));
    const responseHeaders: Record<string, string> = {};
    upstream.headers.forEach((v, k) => { responseHeaders[k] = v; });
    return reply.send({ status: upstream.status, headers: responseHeaders, body: responseBody });
  });

  app.post('/sandbox/llm', async (req: FastifyRequest, reply: FastifyReply) => {
    const bp = await verifyBrokerToken(req.headers.authorization).catch(() =>
      reply.status(401).send({ error: 'Invalid broker token' }),
    );
    if (!bp) return;
    const body = req.body as { prompt?: string; model?: string; maxTokens?: number } | null;
    if (!body?.prompt) return reply.status(400).send({ error: 'prompt is required' });

    try {
      const text = await callGovernedLlm({
        maxTokens: body.maxTokens,
        model: body.model,
        pluginSlug: bp.source_ref,
        prompt: body.prompt,
        userId: bp.user_id,
      });
      return reply.send(text);
    } catch (err) {
      const statusCode = typeof (err as { statusCode?: unknown }).statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 502;
      return reply.status(statusCode).send({ error: err instanceof Error ? err.message : 'LLM router failed' });
    }
  });

  app.post('/sandbox/notify', async (req: FastifyRequest, reply: FastifyReply) => {
    const bp = await verifyBrokerToken(req.headers.authorization).catch(() =>
      reply.status(401).send({ error: 'Invalid broker token' }),
    );
    if (!bp) return;
    const body = req.body as { title?: string; body?: string } | null;
    if (!body?.title) {
      return reply.status(400).send({ error: 'title is required' });
    }
    try {
      await fetch(config.pushServiceUrl + '/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: bp.user_id, title: body.title, body: body.body ?? '', source: 'plugin-broker:' + bp.source_ref }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      return reply.status(502).send({ error: err instanceof Error ? err.message : 'Push delivery failed' });
    }
    return reply.status(204).send();
  });
}
