/**
 * svc-accel-vstup — vynucovací bod společné lane (VB). Jediný, kdo stojí na sítích
 * nájemců `<prefix>-lane`; enginy (vLLM) jsou jen na interní síti jádra.
 *
 * Pořadí na každý požadavek (nic z toho se nepřeskočí, nic nedosazuje výchozí):
 *   1. deklarace čitelná?                         jinak DEKLARACE_NECITELNA (X3)
 *   2. identita ze VSTUPU (lokální × vzdálená adresa) — nikdy z hlavičky (I5, MN1)
 *   2b. členství sítí změřené hlídačem: cizí kontejner na síti nájemce = NAJEMCE_VYPNUT,
 *       na jádře nebo bez aktuálního měření = LANE_NEDOSTUPNA (O-2, clenstvi.ts)
 *   3. klíč nájemce (otisk, konstantní čas)        (I1–I4, I7)
 *   4. hlavičky: pole platformy = odmítnout; třída povinná (I5, R3)
 *   5. cesta: jen deklarované; cokoli jiného CESTA_NEZNAMA (I6, MJ16)
 *   6. tvar těla: pole platformy / neznámá pole odmítnout (PT2, MJ26, V3)
 *   7. alias nájemce → engine (V1–V3)              jinak MODEL_NENALEZEN
 *   8. připravenost enginu — hned, z paměti (R5a, MJ23)
 *   9. kvóta (souběh po třídě, gpu_ms okno, kniha dostupná) (Q2, Q3, MJ19)
 *  10. přeposlání; gpu_ms se účtuje i při chybě a přerušení (Q5)
 * Každé odmítnutí: `{ duvod, error }`, hlavička `x-aisha-odmitl: vstup`, jeden řádek
 * do logu (nájemce, kód, pole, krátký otisk) — nikdy tělo ani klíč (D1′, D2, KJ3).
 */
import { Readable } from 'node:stream';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import { buildHelmetOptions } from '@aisha/security';
import { HLAVICKY, odmitnuti, type Duvod } from '@aisha/accel-protokol';
import { rozhodniClenstvi, type StavClenstvi } from './clenstvi.js';
import { kratkyOtisk, otiskKlice, overKlic, urciNajemce } from './identita.js';
import type { Kvoty } from './kvoty.js';
import { overHlavicky, overTeloChatu, overTeloEmbeddings } from './pole.js';
import type { Pripravenost } from './pripravenost.js';
import type { Engine, Najemce, Tabulka } from './tabulka.js';

export interface Upstream {
  /** POST na engine; `signal` přeruší při odchodu klienta. Chyba spojení = výjimka. */
  post(e: Engine, cesta: string, telo: unknown, signal: AbortSignal): Promise<{ status: number; telo: unknown }>;
  /** POST s odpovědí jako proud bajtů (SSE chatu); `signal` přeruší engine. */
  proud(e: Engine, cesta: string, telo: unknown, signal: AbortSignal): Promise<{ status: number; proud: AsyncIterable<Buffer | string> }>;
}

/** Sůl cache prefixů nájemce (vLLM `cache_salt`): dosazuje ji VSTUP, klientovi patří POLE_PLATFORMY. */
export const solNajemce = (id: string) => `aisha-najemce:${id}`;

/**
 * Proud SSE z enginu → klient: v každé události `data: {…}` se `model` přepíše na alias nájemce
 * (vnitřní jméno adaptéru ani enginu ven nejde). Řádky se skládají přes hranice kusů proudu.
 */
export async function* prepisProudu(zdroj: AsyncIterable<Buffer | string>, alias: string): AsyncGenerator<string> {
  let zbytek = '';
  const radek = (r: string) => {
    if (!r.startsWith('data: ') || r === 'data: [DONE]') return r;
    try {
      const o = JSON.parse(r.slice(6)) as Record<string, unknown>;
      if ('model' in o) o.model = alias;
      return `data: ${JSON.stringify(o)}`;
    } catch {
      return r;
    }
  };
  for await (const kus of zdroj) {
    zbytek += typeof kus === 'string' ? kus : kus.toString('utf8');
    const radky = zbytek.split('\n');
    zbytek = radky.pop() ?? '';
    if (radky.length > 0) yield radky.map(radek).join('\n') + '\n';
  }
  if (zbytek) yield radek(zbytek);
}

export interface Zavislosti {
  /** Aktuální tabulka, nebo důvod, proč není (DEKLARACE_NECITELNA). */
  tabulka(): Tabulka | { necitelna: string };
  pripravenost: Pripravenost;
  /** Členství sítí lane změřené hlídačem. Povinné: bez měření se neobsluhuje nikdo. */
  clenstvi: () => StavClenstvi;
  kvoty: Kvoty;
  upstream: Upstream;
  /** Adresy požadavku. V provozu VŽDY ze socketu (výchozí); testy je podstrčí. */
  adresy?: (req: FastifyRequest) => { lokalni?: string; vzdalena?: string };
  /** Strukturovaný záznam odmítnutí/události — bez těl a bez klíčů. */
  zaznam?: (udalost: string, data: Record<string, unknown>) => void;
  ted?: () => number;
  /** Síť jmenného prostoru VB odpovídá pravidlům (sit.ts)? false = nikoho neobsluhovat. */
  sitOk?: () => boolean;
  /** Načtené a ověřené adaptéry (adaptery.ts). Chybí = žádný adaptér načtený není (fail-closed). */
  adaptery?: { jeNacteny(e: Engine, jmeno: string): boolean };
}

const zeSocketu = (req: FastifyRequest) => ({ lokalni: req.socket.localAddress, vzdalena: req.socket.remoteAddress });

declare module 'fastify' {
  interface FastifyRequest {
    najemce?: Najemce;
    tabulkaVb?: Tabulka;
  }
}

export function vytvorVstup(z: Zavislosti): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });
  // Bezpečnostní hlavičky odpovědi (A05). Tělo ani ostatní hlavičky helmet nemění.
  void app.register(helmet, buildHelmetOptions());
  const adresy = z.adresy ?? zeSocketu;
  const zaznam = z.zaznam ?? (() => {});
  const ted = z.ted ?? Date.now;

  const odmitni = (reply: FastifyReply, duvod: Duvod, error: string, kontext: { najemce?: string; pole?: string; kvota?: string; otisk?: string; znovuZaS?: number } = {}) => {
    const { status, telo } = odmitnuti(duvod, error, { ...(kontext.pole ? { pole: kontext.pole } : {}), ...(kontext.kvota ? { kvota: kontext.kvota } : {}) });
    zaznam('odmitnuti', { najemce: kontext.najemce ?? null, duvod, pole: kontext.pole ?? null, otisk: kontext.otisk ?? null });
    if (kontext.znovuZaS !== undefined) reply.header('retry-after', String(kontext.znovuZaS));
    return reply.code(status).header(HLAVICKY.ODMITL, 'vstup').send(telo);
  };

  // Bez klíče a bez identity: jen „vstup žije“ pro preflight klienta (nic neprozradí).
  app.get('/__vb/zije', async (_req, reply) => reply.code(204).send());

  // Kroky 1–4 pro všechno ostatní.
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/__vb/zije') return;
    // Síť VB nesedí (např. ip_forward=1) = VB by mohl být mostem mezi nájemci: nikoho.
    if (z.sitOk && !z.sitOk()) return odmitni(reply, 'LANE_NEDOSTUPNA', 'síť vstupu neodpovídá pravidlům — vstup neobsluhuje');
    const t = z.tabulka();
    if ('necitelna' in t) return odmitni(reply, 'DEKLARACE_NECITELNA', 'deklarace uzlu není čitelná — nikdo neví, kdo smí');
    const n = urciNajemce(adresy(req), t);
    if (typeof n === 'string') return odmitni(reply, n, n === 'NAJEMCE_VYPNUT' ? 'nájemce je na uzlu vypnutý' : 'požadavek nepřišel vstupem žádného nájemce');
    // Před klíčem: s cizím kontejnerem na síti mohl být klíč odposlechnut — platný klíč nic nemění.
    const c = rozhodniClenstvi(z.clenstvi(), n.id, ted());
    if (c) return odmitni(reply, c.duvod, c.error, { najemce: n.id });
    const auth = req.headers.authorization;
    const klic = overKlic(auth, n, t);
    if (klic !== 'OK') {
      const otisk = auth?.startsWith('Bearer ') ? kratkyOtisk(otiskKlice(auth.slice(7))) : undefined;
      return odmitni(reply, klic, klic === 'KLIC_CHYBI' ? 'chybí klíč (Bearer)' : 'klíč tímto vstupem neplatí', { najemce: n.id, otisk });
    }
    req.najemce = n;
    req.tabulkaVb = t;
  });

  app.get('/v1/models', async (req, reply) => {
    const n = req.najemce!;
    // Seznam se SKLÁDÁ z pohledu nájemce v deklaraci — seznam vLLM (všechny adaptéry
    // všech nájemců, změřeno 10-05) se nikdy nepropouští (V1, MJ21).
    const data = [...n.modely.keys()].sort().map((id) => ({ id, object: 'model', owned_by: 'aisha' }));
    return reply.send({ object: 'list', data });
  });

  app.get('/v1/aisha/mereni', async (req, reply) => reply.send(z.kvoty.agregat(req.najemce!)));
  app.get('/v1/aisha/vrstva', async (req, reply) => reply.send({ trida_duvery: req.najemce!.tridaDuvery }));

  app.post('/v1/embeddings', async (req, reply) => {
    const n = req.najemce!;
    const t = req.tabulkaVb!;
    const h = overHlavicky(req.headers);
    if ('duvod' in h) return odmitni(reply, h.duvod, h.error, { najemce: n.id, pole: h.pole });
    // Režim kvót `varovani`: počet vstupů nad kvótou projde a jde do varování (jako ostatní kvóty).
    const varovani = n.kvoty.rezim === 'varovani';
    const prvni = overTeloEmbeddings(req.body, n.kvoty.davka_max_vstupu);
    const davkaNadMez = !prvni.ok && prvni.duvod === 'KVOTA_PREKROCENA' && varovani;
    const tvar = davkaNadMez ? overTeloEmbeddings(req.body, Number.POSITIVE_INFINITY) : prvni;
    if (!tvar.ok) return odmitni(reply, tvar.duvod, tvar.error, { najemce: n.id, pole: tvar.pole, kvota: tvar.duvod === 'KVOTA_PREKROCENA' ? tvar.pole : undefined });
    const m = n.modely.get(tvar.alias);
    const e = m ? t.enginy.get(m.engine) : undefined;
    if (!m || !e) return odmitni(reply, 'MODEL_NENALEZEN', 'model tento nájemce nemá', { najemce: n.id });
    if (e.druh !== 'pooling') return odmitni(reply, 'MODEL_NENALEZEN', 'model není embedder', { najemce: n.id });
    const r5 = z.pripravenost.rozhodni(e);
    if (r5) return odmitni(reply, r5, r5 === 'LANE_STARTUJE' ? 'lane startuje nebo se zahřívá' : 'lane není dostupná', { najemce: n.id });
    const kvota = z.kvoty.vstup(n, h.trida);
    if (!('uvolni' in kvota)) return odmitni(reply, kvota.duvod, kvota.duvod === 'KVOTA_PREKROCENA' ? 'kvóta nájemce vyčerpaná' : 'spotřebu nejde započítat', { najemce: n.id, kvota: kvota.kvota, znovuZaS: kvota.znovuZaS });
    const prekroceno = [...(davkaNadMez ? ['davka_max_vstupu'] : []), ...kvota.prekroceno];
    if (prekroceno.length > 0) {
      zaznam('kvota_varovani', { najemce: n.id, kvoty: prekroceno, trida: h.trida, vstupu: tvar.vstupy.length });
      reply.header(HLAVICKY.KVOTA, prekroceno.join(','));
    }

    // Přerušení klientem = přerušit i engine a účtovat skutečnou dobu (Q5).
    // `close` na POŽADAVKU Node vyšle už po přečtení těla; odchod klienta pozná
    // jen zavření ODPOVĚDI dřív, než se dopsala.
    const ac = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) ac.abort();
    });
    const start = ted();
    try {
      // max_tokenu aliasu (obsah bez speciálních tokenů). Krátký vstup se vejde vždy: tokenizér udělá
      // nejvýš ~6 tokenů z bajtu (NFKC rozšíří až 18 znaků ze 3 bajtů), takže 6·bajty+1 ≤ max_tokenu
      // nepotřebuje měření. Delší změří tokenizér enginu, pořád pod kvótou nájemce (čas jde do gpu_ms).
      for (const [i, vstup] of tvar.vstupy.entries()) {
        if (6 * Buffer.byteLength(vstup, 'utf8') + 1 <= m.maxTokenu) continue;
        const tk = await z.upstream.post(e, '/tokenize', { model: e.model, prompt: vstup, add_special_tokens: false }, ac.signal);
        const pocet = (tk.telo as { count?: unknown } | null)?.count;
        if (tk.status !== 200 || typeof pocet !== 'number') return odmitni(reply, 'LANE_NEDOSTUPNA', 'engine neodměřil délku vstupu', { najemce: n.id });
        if (pocet > m.maxTokenu) return odmitni(reply, 'POZADAVEK_NEPLATNY', `vstup ${i} má ${pocet} tokenů obsahu, alias dovoluje ${m.maxTokenu}`, { najemce: n.id, pole: 'input' });
      }
      const odpoved = await z.upstream.post(e, '/v1/embeddings', { model: e.model, input: tvar.vstupy, encoding_format: 'float' }, ac.signal);
      if (odpoved.status === 400 || odpoved.status === 422) {
        return odmitni(reply, 'ENGINE_ODMITL', 'engine vstup odmítl (např. delší než okno modelu)', { najemce: n.id });
      }
      if (odpoved.status !== 200) return odmitni(reply, 'LANE_NEDOSTUPNA', `engine odpověděl ${odpoved.status}`, { najemce: n.id });
      const gpuMs = Math.max(0, ted() - start);
      const telo = { ...(odpoved.telo as Record<string, unknown>), model: tvar.alias };
      return reply
        .header(HLAVICKY.IDENTITA, `${e.identita.format}:${e.identita.sha256}`)
        .header(HLAVICKY.REVIZE, e.identita.revize)
        .header(HLAVICKY.RECEPT, e.recept)
        .header(HLAVICKY.GPU_MS, String(gpuMs))
        .send(telo);
    } catch (err) {
      if (ac.signal.aborted) return reply; // klient odešel; nic neposíláme
      zaznam('engine_chyba', { najemce: n.id, engine: e.id, pricina: String((err as Error)?.message ?? err).slice(0, 120) });
      return odmitni(reply, 'LANE_NEDOSTUPNA', 'engine neodpověděl', { najemce: n.id });
    } finally {
      kvota.uvolni(ted() - start);
    }
  });

  app.post('/v1/chat/completions', async (req, reply) => {
    const n = req.najemce!;
    const t = req.tabulkaVb!;
    const h = overHlavicky(req.headers);
    if ('duvod' in h) return odmitni(reply, h.duvod, h.error, { najemce: n.id, pole: h.pole });
    const tvar = overTeloChatu(req.body, (alias) => n.modely.get(alias)?.maxTokenu);
    if (!tvar.ok) return odmitni(reply, tvar.duvod, tvar.error, { najemce: n.id, pole: tvar.pole });
    const m = n.modely.get(tvar.alias);
    const e = m ? t.enginy.get(m.engine) : undefined;
    if (!m || !e) return odmitni(reply, 'MODEL_NENALEZEN', 'model tento nájemce nemá', { najemce: n.id });
    if (e.druh !== 'generate') return odmitni(reply, 'MODEL_NENALEZEN', 'model není chatový', { najemce: n.id });
    const r5 = z.pripravenost.rozhodni(e);
    if (r5) return odmitni(reply, r5, r5 === 'LANE_STARTUJE' ? 'lane startuje nebo se zahřívá' : 'lane není dostupná', { najemce: n.id });
    // Adaptér jen ověřený a načtený dorovnáním (identita celého adresáře = deklarace); jinak se čeká.
    if (m.adapter && !(z.adaptery?.jeNacteny(e, m.adapter) ?? false)) return odmitni(reply, 'LANE_STARTUJE', 'adaptér se načítá nebo neprošel ověřením identity', { najemce: n.id });
    const kvota = z.kvoty.vstup(n, h.trida);
    if (!('uvolni' in kvota)) return odmitni(reply, kvota.duvod, kvota.duvod === 'KVOTA_PREKROCENA' ? 'kvóta nájemce vyčerpaná' : 'spotřebu nejde započítat', { najemce: n.id, kvota: kvota.kvota, znovuZaS: kvota.znovuZaS });
    if (kvota.prekroceno.length > 0) {
      zaznam('kvota_varovani', { najemce: n.id, kvoty: kvota.prekroceno, trida: h.trida });
      reply.header(HLAVICKY.KVOTA, kvota.prekroceno.join(','));
    }
    // Model = adaptér nájemce (prostor jmen <nájemce>.<jméno>) nebo základ enginu; sůl cache dosadí vstup.
    const naEngine = { ...tvar.telo, model: m.adapter ?? e.model, cache_salt: solNajemce(n.id) };
    const ac = new AbortController();
    const start = ted();
    let uvolneno = false;
    const uvolni = () => {
      if (uvolneno) return;
      uvolneno = true;
      kvota.uvolni(ted() - start);
    };
    // Slot a gpu_ms se uvolní při ZAVŘENÍ odpovědi, ať skončí jakkoli (konec proudu, odchod klienta
    // dřív, než se proud začal číst, odmítnutí po chybě enginu). Samotné `finally` generátoru by
    // cestu, kde se generátor nikdy nespustí, minulo: slot souběhu by zůstal obsazený a čas enginu
    // nezapočtený (revize commitu e0e4b04fd).
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) ac.abort();
      uvolni();
    });
    const hlavickyIdentity = () =>
      reply
        .header(HLAVICKY.IDENTITA, `${e.identita.format}:${e.identita.sha256}`)
        .header(HLAVICKY.REVIZE, e.identita.revize)
        .header(HLAVICKY.RECEPT, e.recept);
    try {
      if (!tvar.proud) {
        const odpoved = await z.upstream.post(e, '/v1/chat/completions', naEngine, ac.signal);
        if (odpoved.status === 400 || odpoved.status === 422) return odmitni(reply, 'ENGINE_ODMITL', 'engine požadavek odmítl (např. delší než okno modelu)', { najemce: n.id });
        if (odpoved.status !== 200) return odmitni(reply, 'LANE_NEDOSTUPNA', `engine odpověděl ${odpoved.status}`, { najemce: n.id });
        return hlavickyIdentity().header(HLAVICKY.GPU_MS, String(Math.max(0, ted() - start))).send({ ...(odpoved.telo as Record<string, unknown>), model: tvar.alias });
      }
      const odpoved = await z.upstream.proud(e, '/v1/chat/completions', naEngine, ac.signal);
      if (odpoved.status !== 200) {
        for await (const _ of odpoved.proud) void _; // dočíst a zahodit (obsah enginu klientovi nejde)
        if (odpoved.status === 400 || odpoved.status === 422) return odmitni(reply, 'ENGINE_ODMITL', 'engine požadavek odmítl (např. delší než okno modelu)', { najemce: n.id });
        return odmitni(reply, 'LANE_NEDOSTUPNA', `engine odpověděl ${odpoved.status}`, { najemce: n.id });
      }
      // gpu_ms proudu = obsazení enginu do posledního bajtu (nebo do odchodu klienta, Q5); jde do záznamu,
      // hlavička by u proudu přišla dřív, než je změřená.
      const ven = async function* () {
        try {
          yield* prepisProudu(odpoved.proud, tvar.alias);
        } finally {
          const ms = Math.max(0, ted() - start);
          uvolni();
          zaznam('proud_hotov', { najemce: n.id, engine: e.id, gpu_ms: ms, preruseno: ac.signal.aborted });
        }
      };
      return hlavickyIdentity().header('content-type', 'text/event-stream').header('cache-control', 'no-store').send(Readable.from(ven()));
    } catch (err) {
      uvolni();
      if (ac.signal.aborted) return reply;
      zaznam('engine_chyba', { najemce: n.id, engine: e.id, pricina: String((err as Error)?.message ?? err).slice(0, 120) });
      return odmitni(reply, 'LANE_NEDOSTUPNA', 'engine neodpověděl', { najemce: n.id });
    } finally {
      if (!tvar.proud) uvolni();
    }
  });

  // Cokoli jiného (včetně /v1/load_lora_adapter, /metrics, …) = CESTA_NEZNAMA (I6, MJ16).
  app.setNotFoundHandler(async (req, reply) => odmitni(reply, 'CESTA_NEZNAMA', 'tuto cestu vstup nepropouští', { najemce: req.najemce?.id }));
  app.setErrorHandler(async (err: { statusCode?: number; message?: string }, req, reply) => {
    // Nečitelné JSON tělo apod. — tvar, ne vada lane.
    if (err.statusCode && err.statusCode < 500) {
      return odmitni(reply, 'POZADAVEK_NEPLATNY', 'tělo požadavku nejde přečíst', { najemce: req.najemce?.id });
    }
    zaznam('vnitrni_chyba', { pricina: String(err.message ?? err).slice(0, 120) });
    return odmitni(reply, 'LANE_NEDOSTUPNA', 'vnitřní chyba vstupu', { najemce: req.najemce?.id });
  });
  return app;
}
