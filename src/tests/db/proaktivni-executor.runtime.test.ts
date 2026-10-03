/**
 * Executor akcí po události (F3a) nad SKUTEČNOU databází — dispečer → outbox → executor.
 *
 * ⛔ PROČ (naměřeno 2026-09-26): pravidla `ai_proactive_trigger_definitions` dispečer
 * zapisoval do `ai_proactive_runs` a budil `pg_notify('ai_proactive_dispatch')`, ale
 * NIKDO neposlouchal — běhy ležely `pending` napořád a most do n8n přes pg_net nikdy
 * nic nedoručil (pg_net v obrazu DB není). Tenhle test pinuje CHOVÁNÍ nové cesty:
 * co executor vezme, co nechá být, že jedna událost = jedna akce i při dvojím budíku,
 * že přechodná chyba se zopakuje z outboxu a že CRON slot vznikne jednou.
 *
 * Executor tu běží doopravdy (vytvorExecutor + pool se servisní rolí); jen HTTP do
 * svc-push je atrapa, která zaznamenává volání.
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";
import {
  vytvorExecutor,
  vytvorPoolSluzby,
  type Executor,
  type HttpPost,
} from "../../../services/event-worker/src/proaktivni/executor.js";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const U = randomUUID(); // principál pravidel (created_by)
const V = randomUUID(); // příjemce push (user_id zdrojového řádku)
const TAB = `_f3a_src_${RUN}`;

function sql(q: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tAq"],
    { encoding: "utf8", input: `${q};`, env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  ).trim();
}

const pravidlo = (jmeno: string) =>
  `(select id from public.ai_proactive_trigger_definitions where name = '${jmeno}-${RUN}')`;
const behy = (jmeno: string, zdroj: string) =>
  sql(`select coalesce(string_agg(status, ',' order by created_at), '')
         from public.ai_proactive_runs
        where trigger_definition_id = ${pravidlo(jmeno)} and source_record_id = '${zdroj}'`);
const behId = (jmeno: string, zdroj: string) =>
  sql(`select id from public.ai_proactive_runs
        where trigger_definition_id = ${pravidlo(jmeno)} and source_record_id = '${zdroj}' limit 1`);
function vloz(stav: string, extra = ""): string {
  const id = randomUUID();
  sql(`insert into public.${TAB} (id, user_id, stav, cislo, poznamka)
       values ('${id}', '${V}', '${stav}', 'DL-${RUN}', ${extra === "" ? "null" : `'${extra}'`})`);
  return id;
}

let pushVolani: Array<{ url: string; body: Record<string, unknown> }> = [];
let pushOdpoved = 200;
const post: HttpPost = async (url, init) => {
  pushVolani.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
  return { statusCode: pushOdpoved };
};
const TED = new Date("2026-09-28T10:07:30Z");
let executor: Executor;

beforeAll(() => {
  if (!dbAvailable) return;
  sql(`insert into aisha_auth.users (id, email) values
         ('${U}', 'f3a-u-${RUN}@test.local'), ('${V}', 'f3a-v-${RUN}@test.local')
       on conflict do nothing`);
  sql(`create table public.${TAB} (
         id uuid primary key, user_id uuid, stav text, cislo text, poznamka text)`);
  const ins = (jmeno: string, udalost: string, podminka: string, cfg: string, autor: string | null) =>
    sql(`insert into public.ai_proactive_trigger_definitions
           (name, source_table, source_event, condition, action_type, action_config,
            is_active, cooldown_minutes, created_by)
         values ('${jmeno}-${RUN}', '${TAB}', '${udalost}', '${podminka}'::jsonb, 'notification',
                 '${cfg}'::jsonb, true, 0, ${autor === null ? "null" : `'${autor}'`})`);
  ins("extranet", "INSERT", `{"stav":"hotovo"}`, `{"channel":"extranet","link":"/?detail=zaznam:{id}"}`, U);
  ins("inapp", "INSERT", `{"stav":"hotovo"}`, `{"channel":"in_app"}`, null);
  ins("push", "INSERT", `{"stav":"push"}`,
    `{"channel":"push","title":"Doklad {cislo}","body":"Předáno","recipient":{"field":"user_id"}}`, U);
  ins("email", "INSERT", `{"stav":"email"}`, `{"channel":"email","recipient":"run_user"}`, U);
  ins("cron", "CRON", `{}`,
    `{"channel":"extranet","link":"/prehled?slot={cron_slot}","schedule":{"every_minutes":5}}`, U);

  executor = vytvorExecutor({
    config: {
      databaseUrl: "",
      worker: `test-${RUN}`,
      pushUrl: "http://svc-push.invalid:3012",
      serviceToken: "servisni-token-testu",
      staleSeconds: 1,
      maxAttempts: 3,
      catchupBatch: 50,
    },
    log: { info: () => {}, warn: () => {}, error: () => {} },
    pool: vytvorPoolSluzby(
      `postgresql://${encodeURIComponent(PG_USER)}:${encodeURIComponent(PG_PASSWORD)}@${PG_HOST}:${PG_PORT}/${PG_DATABASE}`,
    ),
    post,
    ted: () => TED,
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  await executor?.zavri();
  sql(`delete from public.ai_proactive_runs where trigger_definition_id in (
         select id from public.ai_proactive_trigger_definitions where name like '%-${RUN}')`);
  sql(`delete from public.ai_proactive_trigger_definitions where name like '%-${RUN}'`);
  sql(`drop table if exists public.${TAB} cascade`);
});

describe("F3a — executor akcí po události nad outboxem", () => {
  it.skipIf(!dbAvailable)("pravidlo pro kanál executoru BEZ principála nejde zapsat", () => {
    expect(() =>
      sql(`insert into public.ai_proactive_trigger_definitions
             (name, source_table, source_event, action_config, is_active)
           values ('bez-principala-${RUN}', '${TAB}', 'INSERT', '{"channel":"push"}'::jsonb, false)`),
    ).toThrow(/ai_proactive_defs_executor_principal_check/);
  });

  it.skipIf(!dbAvailable)("extranet: notify → claim → completed s odkazem; in_app zůstane netknutý", async () => {
    const z = vloz("hotovo");
    expect(behy("extranet", z)).toBe("pending");
    await executor.zpracujNotify(JSON.stringify({ proactive_run_id: behId("extranet", z) }));
    expect(behy("extranet", z)).toBe("completed");
    expect(sql(`select action_result->>'url' from public.ai_proactive_runs where id = '${behId("extranet", z)}'`))
      .toBe(`/?detail=zaznam:${z}`);
    // Kanál, který executor nezná, nesmí zabrat ani notify, ani dohnání.
    await executor.zpracujNotify(JSON.stringify({ proactive_run_id: behId("inapp", z) }));
    sql(`update public.ai_proactive_runs set created_at = now() - interval '1 minute'
          where id = '${behId("inapp", z)}'`);
    await executor.dohnat();
    expect(behy("inapp", z)).toBe("pending");
  });

  it.skipIf(!dbAvailable)("push: dvojí budík = jedno odeslání, příjemce ze zdrojového řádku", async () => {
    pushVolani = [];
    pushOdpoved = 200;
    const z = vloz("push");
    const id = behId("push", z);
    await executor.zpracujNotify(JSON.stringify({ proactive_run_id: id }));
    await executor.zpracujNotify(JSON.stringify({ proactive_run_id: id }));
    expect(pushVolani).toHaveLength(1);
    expect(pushVolani[0].url).toBe("http://svc-push.invalid:3012/send-push-notification");
    expect(pushVolani[0].body).toMatchObject({ user_ids: [V], title: `Doklad DL-${RUN}`, body: "Předáno" });
    expect(behy("push", z)).toBe("completed");
  });

  it.skipIf(!dbAvailable)("push 5xx: běh zůstane running, dohnání ho vrátí a dokončí", async () => {
    pushVolani = [];
    pushOdpoved = 503;
    const z = vloz("push");
    const id = behId("push", z);
    await executor.zpracujNotify(JSON.stringify({ proactive_run_id: id }));
    expect(behy("push", z)).toBe("running");
    sql(`update public.ai_proactive_runs set started_at = now() - interval '1 hour' where id = '${id}'`);
    pushOdpoved = 200;
    await executor.dohnat(); // requeue → pending (created_at je starší než 5 s? ještě ne)
    sql(`update public.ai_proactive_runs set created_at = now() - interval '1 minute' where id = '${id}'`);
    await executor.dohnat();
    expect(behy("push", z)).toBe("completed");
    expect(sql(`select metadata->>'attempts' from public.ai_proactive_runs where id = '${id}'`)).toBe("2");
    expect(pushVolani).toHaveLength(2);
  });

  it.skipIf(!dbAvailable)("po vyčerpání pokusů je zaseknutý běh failed se stopou, ne smyčka", async () => {
    pushOdpoved = 503;
    const z = vloz("push");
    const id = behId("push", z);
    await executor.zpracujNotify(JSON.stringify({ proactive_run_id: id }));
    sql(`update public.ai_proactive_runs
            set started_at = now() - interval '1 hour',
                metadata = metadata || '{"attempts": 3}'::jsonb
          where id = '${id}'`);
    await executor.dohnat();
    expect(behy("push", z)).toBe("failed");
    expect(sql(`select error_message from public.ai_proactive_runs where id = '${id}'`)).toMatch(/^stale:/);
  });

  it.skipIf(!dbAvailable)("email bez pošty (F3b): failed no_transport, ne věčné pending", async () => {
    const z = vloz("email");
    await executor.zpracujNotify(JSON.stringify({ proactive_run_id: behId("email", z) }));
    expect(behy("email", z)).toBe("failed");
    expect(sql(`select error_message from public.ai_proactive_runs where id = '${behId("email", z)}'`))
      .toBe("no_transport");
  });

  it.skipIf(!dbAvailable)("ztracený budík: dohnání vezme běh, o kterém notify nepřišel", async () => {
    const z = vloz("hotovo");
    sql(`update public.ai_proactive_runs set created_at = now() - interval '1 minute'
          where id = '${behId("extranet", z)}'`);
    await executor.dohnat();
    expect(behy("extranet", z)).toBe("completed");
  });

  it.skipIf(!dbAvailable)("CRON: slot se zapíše a provede JEDNOU, i když tik přijde dvakrát", async () => {
    expect(await executor.cronTik()).toBe(1);
    expect(await executor.cronTik()).toBe(0);
    const slot = "2026-09-28T10:05:00Z";
    expect(sql(`select count(*) from public.ai_proactive_runs
                 where trigger_definition_id = ${pravidlo("cron")} and metadata->>'cron_slot' = '${slot}'`)).toBe("1");
    expect(sql(`select status || ' ' || (action_result->>'url') from public.ai_proactive_runs
                 where trigger_definition_id = ${pravidlo("cron")}`)).toBe(`completed /prehled?slot=${slot}`);
  });

  it.skipIf(!dbAvailable)("velký zdrojový řádek: běh vznikne (budík nese jen identifikátory, ne řádek)", () => {
    // Dřív šel celý řádek do pg_notify: nad 8000 B notify spadl, EXCEPTION vrátila blok
    // i se zápisem běhu a pravidlo tiše nevystřelilo.
    const z = vloz("hotovo", "x".repeat(20_000));
    expect(behy("extranet", z)).toBe("pending");
  });
});
