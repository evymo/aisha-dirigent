/**
 * Kalendář nad frontou (`get_workflow_my_steps_block`) — „ukaž mi, co bylo 3. srpna".
 *
 * Zadání majitele (2026-08-05): „Chtělo by to nějaký kalendář, kde si můžu
 * vybrat, že chci vidět něco k tomu datu."
 *
 * Kalendář NENÍ druhá obrazovka ani druhá fronta — je to jiný FILTR nad touž
 * frontou. Nová RPC proto nevzniká; `get_block_data` už parametry od klienta
 * mergu­je (`source_params || p_params`), takže stačilo, aby fronta uměla
 * absolutní datum. Tenhle soubor měří tři pravidla, která z toho plynou, a
 * čtvrté, které se nesmí porušit.
 *
 * ⛔ VŠECHNY TŘI SELHÁVAJÍ TICHÝM PRÁZDNEM, ne chybou — fronta se vykreslí,
 *    jen v ní nic není, a to vypadá jako „ten den se nic nevezlo". Právě proto
 *    se měří tady a ne okem.
 *
 *   1. ABSOLUTNÍ OKNO PŘEBÍJÍ RELATIVNÍ. Blok má v konfiguraci `due='today'`
 *      (řidičova páska). Kdyby se okno ANDovalo, každý jiný den by vrátil nulu.
 *
 *   2. `status='any'`. Výchozí filtr je 'pending', jenže co bylo, to je hotové —
 *      bez tohohle by kalendář na MINULOST vracel prázdno vždycky.
 *
 *   3. ODCHYLKA JE 'failed', ne 'needs_review'. Jinak by se na dni v minulosti
 *      nabízela k odbavení věc, která už dopadla špatně.
 *
 *   4. REGRESE: bez okna se nesmí změnit NIC. Páska řidiče na tuhle funkci
 *      stojí a jede každý den.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const TEMPLATE = `Kalendar ${RUN}`;
const ADMIN = randomUUID();

/**
 * Titulky řádků fronty. ⚠️ `title_src='batch_code'` znamená KÓD BĚHU
 * (`run_code`), ne titulek story — první verze testu čekala titulky a měřila
 * proto vedle, i když funkce vracela správné řádky.
 */
const CEKA = `kal-${RUN}-ceka`;
const HOTOVO = `kal-${RUN}-hotovo`;
const ODCHYLKA = `kal-${RUN}-odchylka`;

/** Dny, na které se fixtura rozprostírá (posun v dnech proti dnešku). */
const DAY_OLD = 10;
const DAY_MID = 3;

function psql(claims: string, sql: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    {
      encoding: "utf8",
      input: `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n\\o\n${sql};`,
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
    },
  ).trim();
}
const svc = (sql: string) => psql('{"role":"service_role"}', sql);

interface Block {
  data: { items: Array<{ title: string; state: string }> };
  provenance: { trace_id: string };
}

/**
 * Fronta tak, jak ji dostane KLIENT: konfigurace bloku (`due='today'`, jako má
 * řidičova páska) sloučená s tím, na co se klient doptal.
 */
function queue(extra: Record<string, unknown>): Block {
  const params = {
    all_assignees: true,
    step_code: "predani",
    due: "today",
    title_src: "batch_code",
    ...extra,
  };
  return JSON.parse(
    psql(
      `{"role":"authenticated","sub":"${ADMIN}"}`,
      `SELECT public.get_workflow_my_steps_block('${JSON.stringify(params)}'::jsonb)`,
    ),
  ) as Block;
}
/** Jen naše řádky — v DB můžou být i cizí a test nesmí měřit je. */
const ours = (b: Block) => b.data.items.filter((i) => i.title?.includes(RUN));
const state = (b: Block, title: string) =>
  ours(b).find((i) => i.title === title)?.state ?? null;

/** Datum posunuté o N dní zpět, ve tvaru, jaký posílá klient. */
function daysAgo(n: number): string {
  return svc(`SELECT (current_date - ${n})::text`);
}

beforeAll(() => {
  if (!dbAvailable) return;

  svc(`INSERT INTO aisha_auth.users (id, email)
       VALUES ('${ADMIN}','kalendar-${RUN}@test.local') ON CONFLICT (id) DO NOTHING`);
  svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}','admin')
       ON CONFLICT DO NOTHING`);
  svc(`INSERT INTO public.production_workflow_templates (name, workflow_steps, is_active)
       SELECT '${TEMPLATE}',
              '[{"step_code":"predani","step_name":"Predani","step_order":1}]'::jsonb, true
       WHERE NOT EXISTS (SELECT 1 FROM public.production_workflow_templates WHERE name = '${TEMPLATE}')`);

  // Starý den nese DVA běhy: jeden čeká, druhý je hotový. Bez obou by se nedalo
  // odlišit „kalendář umí do minulosti" od „kalendář umí jen nedokončené".
  for (const [code, title, day] of [
    [CEKA, `CEKA-${RUN}`, DAY_OLD],
    [HOTOVO, `HOTOVO-${RUN}`, DAY_OLD],
    [ODCHYLKA, `ODCHYLKA-${RUN}`, DAY_MID],
  ] as const) {
    svc(`SELECT public.ensure_workflow_run_for_subject(
           '${TEMPLATE}', '${code}', '${title}', current_date - ${day}, '{}'::jsonb)`);
  }

  const setStatus = (title: string, status: string, completed: boolean) =>
    svc(`UPDATE public.production_workflow_steps s
            SET status = '${status}'
                ${completed ? `, completed_at = now() - interval '${DAY_OLD} days'` : ""}
           FROM public.production_batches b
           JOIN public.partner_stories ps ON ps.id = b.story_id
          WHERE s.batch_id = b.id AND ps.title = '${title}'`);
  setStatus(`HOTOVO-${RUN}`, "completed", true);
  setStatus(`ODCHYLKA-${RUN}`, "failed", false);

  const ready = svc(`SELECT count(*) FROM public.production_workflow_steps s
                       JOIN public.production_batches b ON b.id = s.batch_id
                       JOIN public.partner_stories ps ON ps.id = b.story_id
                      WHERE ps.title LIKE '%-${RUN}'`);
  if (ready !== "3") throw new Error(`fixtura: očekávány 3 kroky, je jich ${ready}`);
});

afterAll(() => {
  if (!dbAvailable) return;
  svc(`DELETE FROM public.production_batches b
        USING public.partner_stories ps
        WHERE b.story_id = ps.id AND ps.title LIKE '%-${RUN}'`);
  svc(`DELETE FROM public.partner_stories WHERE title LIKE '%-${RUN}'`);
  svc(`DELETE FROM public.production_workflow_templates WHERE name = '${TEMPLATE}'`);
  svc(`DELETE FROM public.user_roles WHERE user_id = '${ADMIN}'`);
  svc(`DELETE FROM aisha_auth.users WHERE id = '${ADMIN}'`);
});

describe.skipIf(!dbAvailable)("fronta — kalendář", () => {
  it("⭐ absolutní datum PŘEBÍJÍ `due='today'` z konfigurace bloku", () => {
    // Kdyby se okno ANDovalo s relativním, bylo by tu prázdno — a prázdno
    // vypadá jako „ten den se nic nevezlo".
    const b = queue({ status: "any", date_from: daysAgo(DAY_OLD), date_to: daysAgo(DAY_OLD) });
    expect(ours(b).map((i) => i.title).sort()).toEqual([CEKA, HOTOVO].sort());
  });

  it("⭐ `status='any'` vrací i to, co je hotové — bez toho je minulost vždy prázdná", () => {
    const day = daysAgo(DAY_OLD);
    expect(state(queue({ status: "any", date_from: day }), HOTOVO)).toBe("human_confirmed");
    // Kontrola měřidla: BEZ 'any' tentýž den hotový běh nevrátí. Bez tohohle
    // řádku by první tvrzení mohlo platit i kdyby se `status` ignoroval.
    expect(state(queue({ date_from: day }), HOTOVO)).toBeNull();
  });

  it("⭐ odchylka je 'failed', ne čekající práce", () => {
    const b = queue({ status: "any", date_from: daysAgo(DAY_MID) });
    expect(state(b, ODCHYLKA)).toBe("failed");
  });

  it("vybraný den je vidět v provenance (týž důvod jako dispečerský rozsah)", () => {
    const day = daysAgo(DAY_MID);
    expect(queue({ status: "any", date_from: day }).provenance.trace_id)
      .toContain(`:on:${day}`);
  });

  it("⛔ REGRESE: bez okna se chování NEMĚNÍ (řidičova páska jede každý den)", () => {
    // Fixtura leží v minulosti, takže výchozí „dnešek + pending" nesmí vrátit nic
    // z ní — a hlavně nesmí vrátit odchylku ani hotové.
    expect(ours(queue({}))).toEqual([]);
  });
});
