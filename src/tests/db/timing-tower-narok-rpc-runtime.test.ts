/**
 * Nárok na věž (`get_timing_tower_block`) — řidič své běhy, admin/staff všechny.
 *
 * Jedna plocha, dvě publika: věž není „appka pro řidiče" vedle „pohledu pro
 * dispečink", je to TÁŽ deska s jiným řezem. Proto se nárok testuje na jedné
 * funkci dvěma identitami, ne dvěma bloky.
 *
 * Do 2026-08-05 tu stálo `where true` a tenhle test by měl tři důvody padnout:
 *
 *   1. NÁROK DRŽEL TICHÝ VEDLEJŠÍ ÚČINEK. Cizí běh propadl až na
 *      `jsonb_typeof(run->'pos') = 'number'`, protože pro nevidoucího vrátí
 *      get_batch_workflow_progress `not visible` a `pos` zůstane prázdné.
 *      Pravidlo drženo filtrem na JINÉ vlastnosti = pravidlo, které první
 *      úprava toho filtru mlčky zruší. Případ 2 to drží přímo.
 *
 *   2. ⭐ LIMIT SE APLIKOVAL PŘED NÁROKEM — a to řidiče odstřihlo od VLASTNÍCH
 *      dat. Vybralo se 20 globálně nejnovějších běhů a teprve z nich se
 *      odfiltrovaly cizí, takže řidič, jehož dodávka mezi posledními dvaceti
 *      napříč firmou není, viděl PRÁZDNOU věž. Nad 20 599 běhy v produkci to
 *      není okrajový případ, ale pravidlo. Případ 3 je přesně tenhle tvar:
 *      řidičův běh je STARÝ a čerstvých cizích je víc, než kolik jich limit
 *      pustí.
 *
 *   3. Cizí běh se stejně načetl a spočítal (per-row SECURITY DEFINER volání
 *      progressu) a teprve pak zahodil — práce za data, která volající nesmí
 *      vidět.
 *
 * Vazba řidiče je ta ostrá: uzel BEZ role + `authorized_twin_id` + POTVRZENÁ
 * vazba účtu (`twin_external_refs`, ref_kind='account', state='confirmed').
 * Kdyby uzel roli měl, `workflow_step_visible_to` ji vyhodnotí PŘED vazbou a
 * každý držitel role by viděl každou předávku — přesně to, co řidičská plocha
 * nesmí dopustit.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const TEMPLATE = `Tower narok ${RUN}`;
const ADMIN = randomUUID();
const DRIVER = randomUUID();
/** Twin řidiče — entita, na kterou je běh vázán a na niž ukazuje vazba účtu. */
const DRIVER_TWIN = randomUUID();
/** Kolik cizích ČERSTVÝCH běhů se postaví před řidičův starý. Musí být > limit
 *  dotazu níž, jinak by případ 3 prošel i se špatným pořadím filtr/limit. */
const FRESH_DECOYS = 25;
const TOWER_LIMIT = 20;

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

interface Tower {
  data: { runs: Array<{ batch_id: string; title: string }> };
  provenance: { trace_id: string };
}
function towerAs(uid: string): Tower {
  return JSON.parse(
    psql(`{"role":"authenticated","sub":"${uid}"}`,
         `SELECT public.get_timing_tower_block('${JSON.stringify({ limit: TOWER_LIMIT })}'::jsonb)`),
  ) as Tower;
}
const titles = (t: Tower) => t.data.runs.map((r) => r.title);

beforeAll(() => {
  if (!dbAvailable) return;

  // Uzel ZÁMĚRNĚ BEZ role — viditelnost má stát na vazbě, ne na roli (viz hlavička).
  svc(`INSERT INTO public.production_workflow_templates (name, workflow_steps, is_active)
       SELECT '${TEMPLATE}',
              '[{"step_code":"predej","step_name":"Predani","step_order":1}]'::jsonb, true
       WHERE NOT EXISTS (SELECT 1 FROM public.production_workflow_templates WHERE name = '${TEMPLATE}')`);

  svc(`INSERT INTO aisha_auth.users (id, email) VALUES
         ('${ADMIN}','tower-admin-${RUN}@test.local'),
         ('${DRIVER}','tower-driver-${RUN}@test.local')
       ON CONFLICT (id) DO NOTHING`);
  // Ať test nestojí na tom, kdo je v téhle DB admin — role se přiřadí výslovně.
  svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin')
       ON CONFLICT DO NOTHING`);

  // Řidičův běh je STARÝ (case 3): založí se PRVNÍ a pak ho čerstvé cizí přebijí.
  svc(`SELECT public.ensure_workflow_run_for_subject(
         '${TEMPLATE}', 'tower-${RUN}-mine', 'MUJ-${RUN}', current_date - 60, '{}'::jsonb)`);

  // ── Vazba řidiče na jeho běh ───────────────────────────────────────────────
  //
  // Twin i POTVRZENÁ vazba účtu se zakládají PŘÍMO, a `authorized_twin_id` se
  // píše na krok týmž tvarem, jaký tam zapisuje ensure_workflow_run_for_subject
  // (`input_data.authorized_twin_id`). Není to obcházení produkční cesty, ale
  // ohraničení předmětu měření: tahle sonda měří NÁROK, ne překlad
  // `authorized_twin_ref` → twin. Kdyby fixtura šla přes twin_upsert_entity_audited,
  // sonda by červenala i tehdy, když se rozbije audit twinů — tedy hlásila by vadu
  // na místě, kde žádná není, a skutečné selhání nároku by se v tom ztratilo.
  //
  // ⚠️ `state='confirmed'` je součást PRAVIDLA, ne administrativa: bez ratifikace
  // řidič neuvidí nic, i když běh existuje.
  svc(`INSERT INTO public.twin_entities (id, entity_type, label)
       VALUES ('${DRIVER_TWIN}', 'driver', 'Ridic ${RUN}')
       ON CONFLICT (id) DO NOTHING`);
  // ⚠️ Dvě věci, které schéma VYNUCUJE a bez kterých insert spadne:
  //   · `proposed_by` je NOT NULL bez defaultu — vazba si vždy pamatuje, KDO ji
  //     navrhl,
  //   · check `twin_external_refs_confirmed_has_at` — vazba ve stavu
  //     `confirmed` MUSÍ mít `confirmed_at`. Ratifikace bez času ratifikace
  //     není ratifikace, takže schéma tenhle polovičatý stav nepustí.
  // Obojí je vlastnost ratifikačního workflow, ne formalita; fixtura ho proto
  // musí splnit celé, jinak mlčky nevznikne a sonda červená na prázdnu.
  // ⛔ source = 'aisha_auth': vazba účtu má JEDINÝ zdroj (CHECK twin_external_refs_account_source, 2026-09-10) — dřív tu byl náhradní slug a CHECK ho odmítl.
  svc(`INSERT INTO public.twin_external_refs
         (twin_id, ref_kind, source, source_key, state, proposed_by, confirmed_at, valid_from)
       VALUES ('${DRIVER_TWIN}', 'account', 'aisha_auth', '${DRIVER}', 'confirmed',
               'timing-tower-narok-test', now() - interval '1 day', now() - interval '1 day')
       ON CONFLICT DO NOTHING`);
  svc(`UPDATE public.production_workflow_steps s
          SET input_data = coalesce(s.input_data, '{}'::jsonb)
                           || jsonb_build_object('authorized_twin_id', '${DRIVER_TWIN}')
         FROM public.production_batches b
         JOIN public.partner_stories ps ON ps.id = b.story_id
        WHERE s.batch_id = b.id AND ps.title = 'MUJ-${RUN}'`);

  // Fixtura MUSÍ doložit, že vznikla. Prázdný výsledek by jinak vypadal jako
  // vada nároku, kdežto ve skutečnosti by se neměl kdo dívat na co.
  const bound = svc(`SELECT count(*) FROM public.production_workflow_steps s
                       JOIN public.production_batches b ON b.id = s.batch_id
                       JOIN public.partner_stories ps ON ps.id = b.story_id
                      WHERE ps.title = 'MUJ-${RUN}'
                        AND s.input_data->>'authorized_twin_id' = '${DRIVER_TWIN}'`);
  if (bound !== "1") {
    throw new Error(`fixtura: očekáván 1 krok s vazbou na řidiče, je jich ${bound}`);
  }

  // Cizí ČERSTVÉ běhy — žádná vazba na řidiče ani na admina.
  for (let i = 0; i < FRESH_DECOYS; i++) {
    svc(`SELECT public.ensure_workflow_run_for_subject(
           '${TEMPLATE}', 'tower-${RUN}-x${i}', 'CIZI-${RUN}-${i}', current_date, '{}'::jsonb)`);
  }
});

afterAll(() => {
  if (!dbAvailable) return;
  svc(`DELETE FROM public.production_batches b
        USING public.partner_stories ps
        WHERE b.story_id = ps.id AND ps.title LIKE '%-${RUN}%'`);
  svc(`DELETE FROM public.partner_stories WHERE title LIKE '%-${RUN}%'`);
  svc(`DELETE FROM public.production_workflow_templates WHERE name = '${TEMPLATE}'`);
  svc(`DELETE FROM public.twin_external_refs WHERE twin_id = '${DRIVER_TWIN}'`);
  svc(`DELETE FROM public.twin_entities WHERE id = '${DRIVER_TWIN}'`);
  svc(`DELETE FROM public.user_roles WHERE user_id IN ('${ADMIN}','${DRIVER}')`);
  svc(`DELETE FROM aisha_auth.users WHERE id IN ('${ADMIN}','${DRIVER}')`);
});

describe.skipIf(!dbAvailable)("timing tower — nárok", () => {
  it("admin/staff vidí i běhy, které nejsou jeho", () => {
    const seen = titles(towerAs(ADMIN));
    expect(seen.some((t) => t.startsWith(`CIZI-${RUN}`))).toBe(true);
  });

  it("řidič cizí běh NEVIDÍ", () => {
    const seen = titles(towerAs(DRIVER));
    expect(seen.some((t) => t.startsWith(`CIZI-${RUN}`))).toBe(false);
  });

  it("⭐ řidič vidí SVŮJ starý běh, i když čerstvých cizích je víc než limit", () => {
    // Tohle je ta vada, kterou `where true` schovávalo: nárok až ZA limitem
    // znamená, že řidičovy dodávky vypadnou z okna dřív, než se na ně vůbec
    // dojde. Prázdná věž pak vypadá jako „nemám práci", ne jako chyba.
    const seen = titles(towerAs(DRIVER));
    expect(seen).toContain(`MUJ-${RUN}`);
  });
});
