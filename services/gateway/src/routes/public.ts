/**
 * Public gateway routes — no auth required (rate-limited).
 * Public partners directory with authenticated/anonymous dual mode.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { createHash } from 'node:crypto';
import { translateAuthorizationForPostgrest } from '../auth/postgrest-jwt.js';

const POSTGREST = config.postgrestUrl;
const MAX_RESULTS = 50;
const ANON_RATE_LIMIT = 20; // per hour per IP
const AUTH_RATE_LIMIT = 100; // per hour per user
// Počítadlo komunity: jeden dotaz na vykreslení je záměr, ne nedopatření —
// číslo se nikde nedrží, ukazuje se aktuální stav. Limit tu proto NENÍ cache,
// ale pojistka, aby se z veřejné routy nestal zesilovač mířený na zdrojovou
// aplikaci (source-api).
// 240/h je nad rámec normálního prohlížení (jedno vykreslení = jeden dotaz).
const POCITADLO_LIMIT_ZA_HODINU = 240;

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, limit: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (entry && entry.resetAt > now) {
    if (entry.count >= limit) return false;
    entry.count++;
    return true;
  }
  rateLimitMap.set(key, { count: 1, resetAt: now + 3_600_000 });
  // Periodic cleanup
  if (rateLimitMap.size > 10_000) {
    for (const [k, v] of rateLimitMap) {
      if (v.resetAt < now) rateLimitMap.delete(k);
    }
  }
  return true;
}

async function rpcService<T = unknown>(fn: string, params: Record<string, unknown>): Promise<T | null> {
  const resp = await fetch(`${POSTGREST}/rpc/${fn}`, {
    body: JSON.stringify(params),
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${(process.env.POSTGREST_SERVICE_TOKEN ?? '')}` },
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return null;
  return resp.json() as Promise<T>;
}

async function rpcUser<T = unknown>(fn: string, params: Record<string, unknown>, jwt: string): Promise<T | null> {
  const translated = await translateAuthorizationForPostgrest(`Bearer ${jwt}`);
  if (!translated.ok) return null;

  const resp = await fetch(`${POSTGREST}/rpc/${fn}`, {
    body: JSON.stringify(params),
    headers: { 'Content-Type': 'application/json', 'Authorization': translated.authorization },
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return null;
  return resp.json() as Promise<T>;
}

export const publicRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {

  // ── Public Partners Directory ──
  app.post<{ Body: { city?: string; limit?: number } }>('/partners', async (req, reply) => {
    const authHeader = req.headers.authorization ?? '';
    const hasToken = authHeader.startsWith('Bearer ') && authHeader.length > 7;
    let isAuthenticated = false;
    let userId: string | null = null;
    let jwt = '';

    if (hasToken) {
      jwt = authHeader.substring(7);
      // Verify via PostgREST — if RPC succeeds, user is authenticated
      const userCheck = await rpcUser<{ id: string }>('auth_get_current_user_id', {}, jwt);
      if (userCheck?.id) {
        isAuthenticated = true;
        userId = userCheck.id;
      }
    }

    // Rate limiting
    if (isAuthenticated && userId) {
      if (!checkRateLimit(`user:${userId}`, AUTH_RATE_LIMIT)) {
        return reply.code(429).send({ error: 'Rate limit exceeded' });
      }
    } else {
      const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
        ?? (req.headers['x-real-ip'] as string) ?? 'unknown';
      const ipHash = createHash('sha256').update(clientIp).digest('hex');
      if (!checkRateLimit(`ip:${ipHash}`, ANON_RATE_LIMIT)) {
        return reply.code(429).send({ error: 'Rate limit exceeded' });
      }
    }

    const { city, limit: limitRaw } = req.body ?? {};
    const cityClean = typeof city === 'string' ? city.trim().slice(0, 100) : null;
    const limit = Math.min(Math.max(1, typeof limitRaw === 'number' ? Math.trunc(limitRaw) : MAX_RESULTS), MAX_RESULTS);

    const partnersResult = await rpcService<{ rows?: unknown[] }>('edge_public_partners_directory', {
      p_action: 'get_partners',
      p_payload: { authenticated: isAuthenticated, city: cityClean || null, limit },
    });

    const partners = partnersResult?.rows ?? [];

    let totalCount: number | undefined;
    if (!isAuthenticated) {
      const countResult = await rpcService<{ count?: number }>('edge_public_partners_directory', {
        p_action: 'count_visible', p_payload: {},
      });
      totalCount = countResult?.count;
    }

    // Audit
    await rpcService('write_audit_journal', {
      p_action_type: 'view',
      p_area: 'partners',
      p_details: { city: cityClean, limit, mode: isAuthenticated ? 'authenticated' : 'anonymous', returned: partners.length },
      p_entity_id: null,
      p_entity_type: 'partner_profiles',
      p_summary: 'Partners directory queried',
      p_tags: ['partners'],
      p_user_id: userId,
    }).catch(() => {});

    return reply.send({
      isAuthenticated,
      limit,
      partners,
      totalCount,
    });
  });

  // ── Počet praktikujících (hero domovské stránky) ──
  //
  // ⛔ PROČ PŘES BRÁNU A NE Z PROHLÍŽEČE. Autoritativní číslo žije ve zdrojové
  // aplikaci instance (source-api, Django/DRF), což je JINÝ původ: přímé volání z SPA by znamenalo CORS na
  // cizí službě a natvrdo zadrátovanou adresu ve statickém buildu. Brána volá
  // serverovou stranou, takže prohlížeč mimo vlastní původ nesahá.
  //
  // ⛔ PROČ NE Z DATABÁZE. `get_public_homepage_stats` počítá `memberships` —
  // produktový pojem Studia, ne praktikující; na téhle instanci vrací 0.
  // Federační `get_public_user_count` zase vyžaduje admina, vrací
  // `authoritative: false` (počítá lokální zrcadlo) a při každém volání zapisuje
  // řádek do auditu. Ani jedno není odpověď pro veřejnou stránku.
  //
  // ⛔ NIC SE NEDRŽÍ. Žádná cache: dotaz na vykreslení, aktuální stav, nebo nic.
  // Uložené číslo by po výpadku source-api tvrdilo něco, co už neplatí, a nikdo
  // by nepoznal, jak je staré.
  app.get('/community-count', async (req, reply) => {
    const zaklad = config.sourceApiUrl;
    if (!zaklad) {
      // Chybějící schopnost se PŘIZNÁ. Tichá nula by na hero tvrdila, že
      // komunita je prázdná — a to je horší nepravda než prázdné místo.
      return reply.code(503).send({
        error: 'community_count_unavailable',
        reason: 'SOURCE_API_URL není nastavené — tahle instance nemá federovanou zdrojovou aplikaci.',
      });
    }

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      ?? (req.headers['x-real-ip'] as string) ?? 'unknown';
    const ipHash = createHash('sha256').update(clientIp).digest('hex');
    if (!checkRateLimit(`pocitadlo:${ipHash}`, POCITADLO_LIMIT_ZA_HODINU)) {
      return reply.code(429).send({ error: 'Rate limit exceeded' });
    }

    let odpoved: Response;
    try {
      odpoved = await fetch(`${zaklad.replace(/\/+$/, '')}/v3/public/user_count/`, {
        headers: { Accept: 'application/json' },
        method: 'GET',
        // Hero nesmí čekat na cizí službu. Když se to nestihne, blok prostě
        // nic nevykreslí — to už umí.
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      // Důvod se POJMENUJE. Prázdný catch by z výpadku sítě a z chybné
      // konfigurace udělal týž mlčenlivý stav.
      req.log.warn({ err: String(err) }, 'community-count: source-api neodpovědělo');
      return reply.code(502).send({ error: 'upstream_unreachable' });
    }

    if (!odpoved.ok) {
      req.log.warn({ status: odpoved.status }, 'community-count: source-api vrátilo chybu');
      return reply.code(502).send({ error: 'upstream_error', status: odpoved.status });
    }

    // ⛔ SOURCE-API OBALUJE KAŽDOU ODPOVĚĎ DO `result` (naměřeno 2026-09-03 na
    // `<fork>`). Jeho DRF `RetrieveAPIView` vrací `{"result": serializer.data}` — pro
    // user_count tedy `{"result":{"user_count":4}}`. Brána četla `user_count`
    // na vrchu, dostala undefined a vracela 502 upstream_payload_invalid,
    // ačkoli backend žil a odpovídal (ověřeno wgetem zevnitř kontejneru
    // brány). Počítadlo komunity se proto NIKDY nevykreslilo.
    const telo = (await odpoved.json().catch(() => null)) as
      | { result?: { user_count?: unknown } }
      | null;
    const pocet = Number(telo?.result?.user_count);
    // ⛔ NEČÍSLO NENÍ NULA. Kdyby se sem propsalo 0 nebo NaN, hero by tvrdilo,
    // že komunita je prázdná. Radši se přizná, že se číslo nezjistilo.
    if (!Number.isFinite(pocet) || pocet <= 0) {
      req.log.warn({ telo }, 'community-count: source-api nevrátilo použitelné číslo');
      return reply.code(502).send({ error: 'upstream_payload_invalid' });
    }

    // `source` je ROLE upstreamu (týž slug jako `federated_from: 'source-api'`
    // v svc-source-broker), ne jméno instance — a z URL se NEODVOZUJE, aby
    // veřejná routa neprozrazovala vnitřní hostname. Konzument (CommunityCounterBlock)
    // čte jen `count`.
    return reply.send({ count: Math.trunc(pocet), source: 'source-api' });
  });
};
