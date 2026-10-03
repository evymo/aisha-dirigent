/**
 * Executor akcí po události (F3a) — vstupně-výstupní vrstva nad čistým jádrem.
 *
 * Tři cesty k běhu, všechny přes OUTBOX `ai_proactive_runs` (nic se nedoručuje z paměti):
 *   1. notify `ai_proactive_dispatch` (dispečer ho vydá v transakci se zdrojovým zápisem)
 *      → claim_proactive_run(id);
 *   2. dohnání na tiku → requeue_stale_proactive_runs + claim_pending_proactive_runs;
 *   3. CRON pravidla na tiku → record_cron_proactive_run(slot) (idempotentní) → claim.
 * Zabrání je atomické v DB, takže dvojí notify, dva workery i restart = jedna akce.
 *
 * Přechodné selhání transportu (síť, 5xx) běh ZÁMĚRNĚ nedokončí: zůstane `running`
 * a requeue_stale_proactive_runs ho po `staleSeconds` vrátí (nejvýš `maxAttempts`×).
 * Opakování tedy řídí outbox, ne paměť procesu — restart nic neztratí ani nezdvojí.
 *
 * DB spojení běží jako service_role (claim napřed, pak role — vzor source-brokeru:
 * `is_service_role()` uzná roli sezení, přísnější RPC jen JWT claim).
 */
import pg from 'pg';
import { request } from 'undici';
import {
  KANALY_EXECUTORU,
  naplanuj,
  posledniSlot,
  type Plan,
  type Schopnosti,
  type ZabranyBeh,
} from './jadro.js';

export interface ExecutorConfig {
  databaseUrl: string;
  worker: string;
  pushUrl: string;
  serviceToken: string;
  staleSeconds: number;
  maxAttempts: number;
  catchupBatch: number;
}

export interface ExecutorLog {
  info: (o: object, m: string) => void;
  warn: (o: object, m: string) => void;
  error: (o: object, m: string) => void;
}

/** Jen co executor z undici potřebuje — kvůli testům bez sítě. */
export type HttpPost = (
  url: string,
  init: { headers: Record<string, string>; body: string },
) => Promise<{ statusCode: number }>;

export interface ExecutorDeps {
  config: ExecutorConfig;
  log: ExecutorLog;
  /** Pool s nastavenou servisní rolí (viz vytvorPoolSluzby). */
  pool: Pick<pg.Pool, 'query' | 'end'>;
  post?: HttpPost;
  ted?: () => Date;
}

const KANALY = [...KANALY_EXECUTORU];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pool, jehož každé fyzické spojení je hned po připojení service_role. */
export function vytvorPoolSluzby(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  // 'connect' se vydá dřív, než pool spojení předá volajícímu, a dotazy na klientu
  // se řadí — SET proto proběhne před prvním dotazem executoru.
  pool.on('connect', (client) => {
    void client.query(`SET request.jwt.claims = '{"role":"service_role"}'`);
    void client.query('SET ROLE service_role');
  });
  return pool;
}

const vychoziPost: HttpPost = async (url, init) => {
  const res = await request(url, { method: 'POST', headers: init.headers, body: init.body });
  await res.body.dump();
  return { statusCode: res.statusCode };
};

export function vytvorExecutor(deps: ExecutorDeps) {
  const { config, log, pool } = deps;
  const post = deps.post ?? vychoziPost;
  const ted = deps.ted ?? (() => new Date());
  const schopnosti: Schopnosti = {
    push: config.pushUrl !== '' && config.serviceToken !== '',
    email: false, // F3b
  };

  async function jeden<T>(sql: string, params: unknown[]): Promise<T | null> {
    const { rows } = await pool.query<{ v: T | null }>(sql, params);
    return rows[0]?.v ?? null;
  }

  async function dokonci(
    beh: ZabranyBeh,
    stav: 'completed' | 'failed' | 'skipped',
    akce: string | null,
    vysledek: Record<string, unknown> | null,
    chyba: string | null,
  ): Promise<void> {
    const ok = await jeden<boolean>(
      'SELECT public.finish_proactive_run($1, $2, $3, $4::jsonb, $5) AS v',
      [beh.run.id, stav, akce, vysledek === null ? null : JSON.stringify(vysledek), chyba],
    );
    if (!ok) {
      // Mezitím vráceno jako zaseknuté a zabráno jinde — výsledek zahazujeme nahlas.
      log.warn({ run: beh.run.id, stav }, 'proaktivní: běh už není running — výsledek zahozen');
    }
  }

  async function proved(beh: ZabranyBeh): Promise<void> {
    const plan: Plan = naplanuj(beh, schopnosti);
    const zaklad = { run: beh.run.id, pravidlo: beh.definition.name };
    switch (plan.druh) {
      case 'selhat':
        log.warn({ ...zaklad, duvod: plan.duvod }, 'proaktivní: pravidlo nejde provést');
        await dokonci(beh, 'failed', null, null, plan.duvod);
        return;
      case 'preskocit':
        await dokonci(beh, 'skipped', null, null, plan.duvod);
        return;
      case 'extranet':
        // „Doputování“ do extranetu = sekce ukáže data, která už existují; akce jen
        // zapíše odkaz, aby šlo z běhu prokliknout. Žádná druhá kopie záznamu.
        await dokonci(beh, 'completed', 'extranet_link', { url: plan.odkaz }, null);
        return;
      case 'push': {
        let status: number;
        try {
          ({ statusCode: status } = await post(`${config.pushUrl.replace(/\/$/, '')}/send-push-notification`, {
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${config.serviceToken}`,
            },
            body: JSON.stringify({
              user_ids: plan.prijemci,
              title: plan.titulek,
              body: plan.text,
              category: plan.kategorie,
              ...(plan.odkaz ? { link: plan.odkaz } : {}),
            }),
          }));
        } catch (err) {
          // Síť: běh nedokončit — vrátí ho requeue_stale_proactive_runs.
          log.warn({ ...zaklad, err: (err as Error).message }, 'proaktivní: svc-push nedostupný, zkusí se znovu');
          return;
        }
        if (status >= 200 && status < 300) {
          await dokonci(beh, 'completed', 'push_sent', { recipients: plan.prijemci.length, status }, null);
        } else if (status >= 500) {
          log.warn({ ...zaklad, status }, 'proaktivní: svc-push 5xx, zkusí se znovu');
        } else {
          // 4xx = odmítnutí (auth, validace) — opakování nepomůže.
          await dokonci(beh, 'failed', null, { status }, `push_rejected:${status}`);
        }
        return;
      }
    }
  }

  async function zaberAProved(runId: string): Promise<boolean> {
    const beh = await jeden<ZabranyBeh>(
      'SELECT public.claim_proactive_run($1, $2, $3) AS v',
      [runId, config.worker, KANALY],
    );
    if (!beh) return false;
    await proved(beh);
    return true;
  }

  return {
    schopnosti,

    /** Notify `ai_proactive_dispatch`: nese jen identifikátory, data se čtou z outboxu. */
    async zpracujNotify(surovy: string): Promise<void> {
      let id: unknown;
      try {
        id = (JSON.parse(surovy) as { proactive_run_id?: unknown }).proactive_run_id;
      } catch {
        log.warn({}, 'proaktivní: notify není JSON — ignoruji (dohnání běh stejně najde)');
        return;
      }
      if (typeof id !== 'string' || !UUID.test(id)) return;
      await zaberAProved(id);
    },

    /** Tik: vrátit zaseknuté, pak zabrat, co zůstalo ležet (notify se ztratil). */
    async dohnat(): Promise<{ vraceno: number; selhalo: number; provedeno: number }> {
      const stale = (await jeden<{ requeued: number; failed: number }>(
        'SELECT public.requeue_stale_proactive_runs($1, $2, $3) AS v',
        [KANALY, config.staleSeconds, config.maxAttempts],
      )) ?? { requeued: 0, failed: 0 };
      const davka = (await jeden<ZabranyBeh[]>(
        'SELECT public.claim_pending_proactive_runs($1, $2, $3, $4) AS v',
        [config.worker, KANALY, config.catchupBatch, 5],
      )) ?? [];
      for (const beh of davka) await proved(beh);
      if (stale.requeued + stale.failed + davka.length > 0) {
        log.info({ vraceno: stale.requeued, selhalo: stale.failed, provedeno: davka.length }, 'proaktivní: dohnání');
      }
      return { vraceno: stale.requeued, selhalo: stale.failed, provedeno: davka.length };
    },

    /** Tik CRON: poslední splatný slot každého pravidla → outbox (idempotentně) → provést. */
    async cronTik(): Promise<number> {
      const definice = (await jeden<Array<{ id: string; name: string; action_config: Record<string, unknown> }>>(
        'SELECT public.list_cron_proactive_definitions($1) AS v',
        [KANALY],
      )) ?? [];
      let zapsano = 0;
      for (const d of definice) {
        const slot = posledniSlot(d.action_config['schedule'], ted());
        if (!slot) {
          log.warn({ pravidlo: d.name }, 'proaktivní: CRON pravidlo bez platného action_config.schedule');
          continue;
        }
        const runId = await jeden<string>(
          'SELECT public.record_cron_proactive_run($1, $2) AS v',
          [d.id, slot.toISOString()],
        );
        if (runId) {
          zapsano += 1;
          await zaberAProved(runId);
        }
      }
      return zapsano;
    },

    async zavri(): Promise<void> {
      await pool.end();
    },
  };
}

export type Executor = ReturnType<typeof vytvorExecutor>;
