import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { verifyKeycloakClaims } from '../auth/postgrest-jwt.js';

/**
 * GET /api/health — provozní stav. Kolik se ho ukáže, plyne z OPRÁVNĚNÍ.
 *
 * ⛔ DVĚ VADY, obě naměřené na produkci 2026-08-02.
 *
 * 1. LHALO. Sonda vyžadovala `res.ok`, tedy 2xx. Jenže kořen PostgRESTu tady
 *    vrací 404 — a 404 je ODPOVĚĎ: služba stojí, poslouchá a odpovídá. Sonda
 *    z ní dělala `http_404` a endpoint hlásil `degraded`, zatímco RPC přes
 *    tutéž službu vracelo 200. Zdravý systém označený za nemocný je táž třída
 *    jako zelený deploy, který nic nenasadil — jen opačným směrem.
 *    Nově: jakákoli HTTP odpověď = služba žije; vadou je až 5xx nebo to, že
 *    se spojení vůbec nepovede (`unreachable` = NEVÍME, ne „je rozbitá").
 *
 * 2. VYDÁVALO SLOŽENÍ KOMUKOLI. Endpoint je veřejný (volá ho přihlašovací
 *    stránka z prohlížeče) a v odpovědi byla jména komponent — `postgrest`,
 *    `keycloak`, `storageAuth` — i jejich stavy. Nepřihlášený se z něj tedy
 *    dozvěděl, z čeho je systém složený, i kdyby stránka sama mlčela.
 *
 *    Detail se ale NEZAHAZUJE: kdo se prokáže platným tokenem, dostane ho celý.
 *    Anonym dostane příznak, přihlášený diagnostiku — táž logika jako všude
 *    jinde ve stacku, kde se rozsah odvozuje z oprávnění, ne z cesty.
 *
 * ⚠️ Sonda Keycloaku hlásí `unreachable` z jiného důvodu, než je tenhle soubor:
 *    `KEYCLOAK_INTERNAL_URL` nese kontejnerový alias místo mesh adresy, kterou
 *    systém má (sourozenci ji mají: postgrest.mesh…, storage-auth.mesh…).
 *    To se opravuje v dodávce adres, ne tady — sonda měří poctivě, co dostane.
 */
export const healthRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Liveness (docker healthcheck) — 200, dokud proces žije.
  app.get('/health', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ status: 'ok' });
  });

  app.get('/api/health', async (req: FastifyRequest, reply: FastifyReply) => {
    const upstreams: Record<string, Stav> = {
      postgrest: await probe(`${config.postgrestUrl}/`),
      keycloak: await probe(`${config.keycloakUrl}/health/ready`),
      storageAuth: await probe(`${config.storageAuthUrl}/health`),
    };

    // Nejhorší stav vyhrává. `unreachable` drží `degraded` schválně: neumíme-li
    // se zeptat, nesmíme tvrdit, že je vše v pořádku.
    const vseOk = Object.values(upstreams).every((c) => c.status === 'ok');
    const telo: Record<string, unknown> = {
      status: vseOk ? 'healthy' : 'degraded',
      checked_at: new Date().toISOString(),
    };

    // Detail jen tomu, kdo se prokázal. Ověřuje se PODPIS a issuer (JWKS), ne
    // přítomnost hlavičky — jinak by stačilo poslat cokoli začínající "Bearer".
    const claims = await verifyKeycloakClaims(req.headers.authorization);
    if (claims) {
      telo.gateway = 'ok';
      telo.upstreams = upstreams;
    }

    return reply.status(vseOk ? 200 : 503).send(telo);
  });
};

type Stav = { status: 'ok' | 'fault' | 'unreachable'; httpStatus?: number; latencyMs?: number };

async function probe(url: string): Promise<Stav> {
  const start = performance.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const latencyMs = Math.round(performance.now() - start);
    // 404 od běžící služby je ODPOVĚĎ, ne porucha — kořen PostgRESTu ji vrací
    // legitimně. Poruchou je 5xx: tam služba sama hlásí, že si neví rady.
    return { status: res.status >= 500 ? 'fault' : 'ok', httpStatus: res.status, latencyMs };
  } catch {
    return { status: 'unreachable' };
  }
}
