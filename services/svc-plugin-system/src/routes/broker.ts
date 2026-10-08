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
 * PLUGIN_RPC_WHITELIST) as before. Every RPC argument that NAMES A SOURCE must be the
 * plugin's own source (or its `<source>:<sub>`); runs without a source may not send one
 * at all — one check for both branches (sandbox-politika.ts `ciziZdroj`).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { jwtVerify } from 'jose';
import { createSsrfGuard, SsrfBlockedError } from '@aisha/security';
import { config } from '../config.js';
import { getBrokerSecretBytes } from '../broker-secret.js';
import { zalozitMetr, zaznamenatVolani, zaznamenatZapis } from '../mereni.js';
import { callGovernedLlm } from '../llm-router.js';
import { RpcMimoWhitelistError, rpcSandboxed, rpcService, rpcServiceVoid } from '../postgrest.js';
import { ciziZdroj, politikaPluginu } from '../sandbox-politika.js';

/**
 * Proč broker volání pluginu ODMÍTL — uzavřený výčet; jediný domov kódů i jejich
 * HTTP stavu.
 *
 * ⛔ NAMĚŘENO 2026-10-04 (fork riq po nasazení): běh pluginu dostal 9× 403 na
 * /sandbox/fetch a 1× 403 na /sandbox/rpc a důvod nezapsal runner ani broker —
 * co bylo špatně, je NEZMĚŘENO. Každé odmítnutí teď nese strojový `duvod` v těle
 * a jeden strukturovaný řádek v logu služby (viz `odmitnout`).
 *
 * Kód = větev brokeru, která ho vydá (žádný do zásoby); test
 * broker-odmitnuti.unit.test.ts projde každou větev a hlídá, že výčet = praxe.
 */
export const DUVODY_ODMITNUTI = {
  /** Chybí `Authorization: Bearer …`, nebo token neprošel ověřením (podpis, audience, platnost). */
  token_neplatny: 401,
  /** Chybí povinné pole těla (key / fn / url / prompt / title) nebo neznámý `redirect`. */
  pozadavek_neplatny: 400,
  /** Konfigurace se vydává jen běhu plugin-exec s pluginem v tokenu. */
  druh_behu_nepovoleny: 403,
  /** Konfiguraci běhu nejde v DB složit (get_plugin_runtime_config selhal). */
  konfigurace_necitelna: 503,
  /** Sandbox politiku pluginu nejde přečíst (get_plugin_sandbox_policy selhal) — ani povolení, ani tichý zákaz. */
  politika_necitelna: 503,
  /** RPC není ve SCHVÁLENÉ sandbox politice pluginu (běh plugin-exec). */
  fn_mimo_politiku: 403,
  /** RPC není v PLUGIN_RPC_WHITELIST služby (jiný druh běhu než plugin-exec). */
  fn_mimo_whitelist: 403,
  /**
   * Argument, který JMENUJE ZDROJ (třída `ciziZdroj` v sandbox-politika.ts), nepatří zdroji pluginu —
   * nebo ho poslal plugin bez zdroje či běh, který pluginem není. Obě větve /sandbox/rpc.
   */
  zdroj_cizi: 403,
  /** Povolené RPC selhalo v databázi (PostgREST odpověděl chybou). */
  rpc_selhalo: 403,
  /** Seznam povolených cílů je prázdný (neschválená politika / prázdná proměnná služby). */
  zadny_povoleny_cil: 403,
  /** SSRF guard: URL nejde rozebrat. */
  url_neplatna: 403,
  /** SSRF guard: schéma mimo https. */
  schema_zakazane: 403,
  /** SSRF guard: hostitel není mezi povolenými. */
  cil_mimo_allowlist: 403,
  /** SSRF guard: hostitel se rozřešil na zakázanou adresu (loopback, RFC1918, metadata…). */
  ip_blokovana: 403,
  /** SSRF guard: přesměrování odmítnuto (redirect 'error', cizí origin s tělem, příliš hopů, vadná Location). */
  presmerovani_odmitnuto: 403,
} as const;

export type DuvodOdmitnuti = keyof typeof DUVODY_ODMITNUTI;

/** Důvod SSRF guardu → kód brokeru. Record nad sjednocením z @aisha/security: nový důvod tam = chyba překladu tady. */
const DUVOD_ZE_SSRF: Record<SsrfBlockedError['reason'], DuvodOdmitnuti> = {
  parse: 'url_neplatna',
  scheme: 'schema_zakazane',
  host: 'cil_mimo_allowlist',
  ip: 'ip_blokovana',
  redirect: 'presmerovani_odmitnuto',
};

type DruhVolani = 'config' | 'rpc' | 'kv/get' | 'kv/set' | 'kv/delete' | 'fetch' | 'llm' | 'notify';

interface Odmitnuti {
  druh: DruhVolani;
  duvod: DuvodOdmitnuti;
  /** Čitelná věta pro plugin (beze změny proti dřívějšku — pluginy a testy ji čtou). */
  error: string;
  /** Ověřený token běhu; chybí jen u `token_neplatny`. */
  bp?: BrokerTokenPayload;
  /** Jen fetch: HOSTITEL cíle — nikdy cesta, query, hlavičky ani tělo (URL může nést token). */
  host?: string | null;
  /** Jen rpc: jméno funkce — nikdy hodnoty parametrů. */
  fn?: string;
  /** Jen zdroj_cizi: CESTA argumentu (`p_events[3].source`) z `ciziZdroj` — jméno, ne hodnota. */
  parametr?: string;
  /**
   * Chyba DB (rpc_selhalo, *_necitelna). Do logu jde jen HTTP stav PostgRESTu a typ chyby —
   * NE zpráva: chyba PostgRESTu ozvěnou nese hodnoty (constraint „Key (vin)=(…)").
   */
  chyba?: unknown;
}

/**
 * Odmítnutí = JEDEN strukturovaný řádek v logu služby + tělo `{ duvod, error }`.
 * `duvod` je v těle PRVNÍ: shim dává do textu výjimky jen prvních 200 znaků těla
 * (images/plugin-exec/shim/src/broker.ts) a dlouhá věta (rpc_selhalo nese zprávu
 * PostgRESTu) by kód jinak uřízla.
 */
function odmitnout(req: FastifyRequest, reply: FastifyReply, o: Odmitnuti): FastifyReply {
  req.log.warn(
    {
      odmitnuti: true,
      druh: o.druh,
      duvod: o.duvod,
      plugin: o.bp?.source_ref ?? null,
      beh: o.bp?.sub ?? null,
      ...(o.host !== undefined ? { host: o.host } : {}),
      ...(o.fn !== undefined ? { fn: o.fn.slice(0, 128) } : {}),
      ...(o.parametr !== undefined ? { parametr: o.parametr.slice(0, 128) } : {}),
      ...(o.chyba !== undefined ? popisChyby(o.chyba) : {}),
    },
    'broker odmítl volání pluginu',
  );
  return reply.status(DUVODY_ODMITNUTI[o.duvod]).send({ duvod: o.duvod, error: o.error });
}

/** Jen HOSTITEL cílové URL (bez portu, přihlašovacích údajů, cesty i query); nerozebratelná URL → null. */
function hostitel(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/** Chyba DB do logu: HTTP stav PostgRESTError (pole `status`) a jméno třídy chyby — nikdy zpráva ani tělo. */
function popisChyby(err: unknown): { stav_db: number | null; chyba_typ: string } {
  const stav = (err as { status?: unknown } | null)?.status;
  return {
    stav_db: typeof stav === 'number' ? stav : null,
    chyba_typ: err instanceof Error ? err.name : typeof err,
  };
}

/**
 * Ověří token běhu; při selhání odpoví 401 `token_neplatny` a vrátí null — trasa skončí.
 *
 * PROČ explicitní null: dřívější `verifyBrokerToken(…).catch(() => reply.status(401).send(…))`
 * + `if (!bp) return` fungoval jen díky tomu, že odpověď fastify je thenable a `.catch`
 * ji rozbalí na undefined (změřeno 2026-10-04: trasa po 401 dál neběží). Na tom bezpečnost
 * brokeru stát nemá; test broker-odmitnuti hlídá, že po 401 neodejde nic (DB, dodavatel, push, LLM).
 */
async function overitToken(req: FastifyRequest, reply: FastifyReply, druh: DruhVolani): Promise<BrokerTokenPayload | null> {
  try {
    return await verifyBrokerToken(req.headers.authorization);
  } catch {
    odmitnout(req, reply, { druh, duvod: 'token_neplatny', error: 'Invalid broker token' });
    return null;
  }
}

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
    const bp = await overitToken(req, reply, 'config');
    if (!bp) return reply;
    if (bp.kind !== 'plugin-exec' || !bp.source_ref) {
      return odmitnout(req, reply, {
        druh: 'config', duvod: 'druh_behu_nepovoleny', bp,
        error: 'Configuration is only issued to plugin-exec runs',
      });
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
      return odmitnout(req, reply, {
        druh: 'config', duvod: 'konfigurace_necitelna', bp,
        error: 'Plugin configuration unavailable',
        chyba: err,
      });
    }
  });

  app.post('/sandbox/rpc', async (req: FastifyRequest, reply: FastifyReply) => {
    const bp = await overitToken(req, reply, 'rpc');
    if (!bp) return reply;
    const body = req.body as { fn?: string; params?: Record<string, unknown> } | null;
    if (!body?.fn) {
      return odmitnout(req, reply, { druh: 'rpc', duvod: 'pozadavek_neplatny', bp, error: 'fn is required' });
    }
    const fn = body.fn;
    // Běh pluginu: povolená RPC jsou ta ze SCHVÁLENÉ sandbox politiky pluginu
    // (proměnná služby ji smí jen zúžit). Viz sandbox-politika.ts.
    if (bp.kind === 'plugin-exec' && bp.source_ref) {
      let politika: Awaited<ReturnType<typeof politikaPluginu>>;
      try {
        politika = await politikaPluginu(bp.source_ref);
      } catch (err) {
        return odmitnout(req, reply, {
          druh: 'rpc', duvod: 'politika_necitelna', bp, fn,
          error: 'Plugin sandbox policy unavailable',
          chyba: err,
        });
      }
      if (!politika.rpc.includes(fn)) {
        return odmitnout(req, reply, {
          druh: 'rpc', duvod: 'fn_mimo_politiku', bp, fn,
          error: `Plugin RPC call to '${fn}' is not in its approved sandbox policy`,
        });
      }
      const cizi = ciziZdroj(politika.zdroj, body.params ?? {});
      if (cizi) {
        return odmitnout(req, reply, {
          druh: 'rpc', duvod: 'zdroj_cizi', bp, fn, parametr: cizi,
          error: `Plugin '${bp.source_ref}' may only write under its own source (${cizi})`,
        });
      }
      try {
        const result = await rpcService(fn, body.params ?? {});
        zaznamenatZapis(bp.sub, fn, body.params ?? {});
        return reply.send(result);
      } catch (err) {
        return odmitnout(req, reply, {
          druh: 'rpc', duvod: 'rpc_selhalo', bp, fn, chyba: err,
          error: err instanceof Error ? err.message : 'RPC denied',
        });
      }
    }
    // Jiný běh než plugin nemá zdroj — pod žádným jménem zdroje zapisovat nesmí (týž domov kontroly).
    const cizi = ciziZdroj(null, body.params ?? {});
    if (cizi) {
      return odmitnout(req, reply, {
        druh: 'rpc', duvod: 'zdroj_cizi', bp, fn, parametr: cizi,
        error: `Run '${bp.kind}' has no source and may not write under one (${cizi})`,
      });
    }
    try {
      const result = await rpcSandboxed(fn, body.params ?? {});
      zaznamenatZapis(bp.sub, fn, body.params ?? {});
      return reply.send(result);
    } catch (err) {
      // Odmítnutí pravidlem (whitelist) není porucha DB — chyba se k němu nepřikládá.
      const mimoWhitelist = err instanceof RpcMimoWhitelistError;
      return odmitnout(req, reply, {
        druh: 'rpc',
        duvod: mimoWhitelist ? 'fn_mimo_whitelist' : 'rpc_selhalo',
        bp, fn,
        ...(mimoWhitelist ? {} : { chyba: err }),
        error: err instanceof Error ? err.message : 'RPC denied',
      });
    }
  });

  app.post('/sandbox/kv/get', async (req: FastifyRequest, reply: FastifyReply) => {
    const bp = await overitToken(req, reply, 'kv/get');
    if (!bp) return reply;
    const body = req.body as { key?: string } | null;
    if (!body?.key) {
      return odmitnout(req, reply, { druh: 'kv/get', duvod: 'pozadavek_neplatny', bp, error: 'key is required' });
    }
    const result = await rpcService('plugin_kv_get', { p_key: body.key, p_plugin: bp.source_ref });
    // ⛔ NAMĚŘENO 2026-10-04 (čtení mainu ab87c8a7a): `reply.send(řetězec)` pošle
    // fastify jako text/plain BEZ uvozovek a shim tělo `JSON.parse`-ne — uložený
    // kurzor "12345678" se vrátil jako ČÍSLO, "01234567" jako výjimka. Odpověď je
    // proto vždy JSON hodnota; nepřítomný klíč = `null` (plugin_kv_get vrací 'null').
    return reply.type('application/json').send(JSON.stringify(result ?? null));
  });

  app.post('/sandbox/kv/set', async (req: FastifyRequest, reply: FastifyReply) => {
    const bp = await overitToken(req, reply, 'kv/set');
    if (!bp) return reply;
    const body = req.body as { key?: string; value?: unknown } | null;
    if (!body?.key) {
      return odmitnout(req, reply, { druh: 'kv/set', duvod: 'pozadavek_neplatny', bp, error: 'key is required' });
    }
    // plugin_kv_set je RETURNS void → PostgREST 204 bez těla; viz rpcServiceVoid.
    await rpcServiceVoid('plugin_kv_set', { p_key: body.key, p_plugin: bp.source_ref, p_value: body.value });
    return reply.status(204).send();
  });

  app.post('/sandbox/kv/delete', async (req: FastifyRequest, reply: FastifyReply) => {
    const bp = await overitToken(req, reply, 'kv/delete');
    if (!bp) return reply;
    const body = req.body as { key?: string } | null;
    if (!body?.key) {
      return odmitnout(req, reply, { druh: 'kv/delete', duvod: 'pozadavek_neplatny', bp, error: 'key is required' });
    }
    await rpcServiceVoid('plugin_kv_delete', { p_key: body.key, p_plugin: bp.source_ref });
    return reply.status(204).send();
  });

  app.post('/sandbox/fetch', async (req: FastifyRequest, reply: FastifyReply) => {
    const bp = await overitToken(req, reply, 'fetch');
    if (!bp) return reply;
    const body = req.body as {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string | null;
      redirect?: unknown;
    } | null;
    if (!body?.url) {
      return odmitnout(req, reply, { druh: 'fetch', duvod: 'pozadavek_neplatny', bp, error: 'url is required' });
    }
    // Do logu jen hostitel — URL pluginu může v cestě nebo query nést token.
    const host = hostitel(body.url);
    // The plugin's `redirect` keeps its fetch meaning, but it is the SSRF guard
    // that enforces it — every mode goes through safeFetch, so no mode can skip
    // the per-hop allowlist/IP check or carry the plugin's headers/body to
    // another origin. Absent = fetch's own default 'follow' (what shim images
    // built before this field existed expect). Anything else is rejected.
    const redirect = body.redirect ?? 'follow';
    if (redirect !== 'follow' && redirect !== 'manual' && redirect !== 'error') {
      return odmitnout(req, reply, {
        druh: 'fetch', duvod: 'pozadavek_neplatny', bp, host,
        error: "redirect must be 'follow', 'manual' or 'error'",
      });
    }

    // Běh pluginu: hostitelé ze SCHVÁLENÉ sandbox politiky pluginu (proměnná
    // služby ji smí jen zúžit); jiné druhy běhu dál proměnná služby.
    let hosty: string[];
    if (bp.kind === 'plugin-exec' && bp.source_ref) {
      try {
        hosty = (await politikaPluginu(bp.source_ref)).hosty;
      } catch (err) {
        return odmitnout(req, reply, {
          druh: 'fetch', duvod: 'politika_necitelna', bp, host,
          error: 'Plugin sandbox policy unavailable',
          chyba: err,
        });
      }
    } else {
      hosty = config.networkAllowlist;
    }

    // Default-deny: empty allowlist => no outbound calls.
    if (hosty.length === 0) {
      return odmitnout(req, reply, {
        druh: 'fetch', duvod: 'zadny_povoleny_cil', bp, host,
        error: 'No network destinations are allowed for this plugin',
      });
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
        // err.message NE: u přesměrování nese kus Location (i s query).
        return odmitnout(req, reply, {
          druh: 'fetch', duvod: DUVOD_ZE_SSRF[err.reason], bp, host,
          error: `Network access blocked: ${err.reason}`,
        });
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
    const bp = await overitToken(req, reply, 'llm');
    if (!bp) return reply;
    const body = req.body as { prompt?: string; model?: string; maxTokens?: number } | null;
    if (!body?.prompt) {
      return odmitnout(req, reply, { druh: 'llm', duvod: 'pozadavek_neplatny', bp, error: 'prompt is required' });
    }

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
    const bp = await overitToken(req, reply, 'notify');
    if (!bp) return reply;
    const body = req.body as { title?: string; body?: string } | null;
    if (!body?.title) {
      return odmitnout(req, reply, { druh: 'notify', duvod: 'pozadavek_neplatny', bp, error: 'title is required' });
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
