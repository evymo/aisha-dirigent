/**
 * `all_assignees` — dispečerský pohled na TUTÉŽ frontu, a proč ho nesmí zapnout
 * konfigurace sama.
 *
 * Řidičova fronta je osobní (`workflow_step_visible_to`) a bloky ji navíc omezují
 * na dnešek. To je správně pro toho, kdo řídí, a nepoužitelné pro toho, kdo
 * dispečuje: změřeno na produkci 2026-07-30 — z 20 212 běhů expedice má datum
 * dneška JEDINÝ, takže admin otevřel frontu a dostal prázdno.
 *
 * Nebezpečí je zřejmé: příznak v `source_params`, který rozšiřuje viditelnost, je
 * eskalace práv schovaná v datech. Bloky přitom smí zakládat kdokoli s přístupem
 * k instančnímu SQL. Proto `all_assignees` platí JEN v konjunkci s
 * `is_admin_or_staff()` přímo v predikátu — a tenhle test to drží:
 *
 *   1. admin s příznakem vidí i kroky, které nejsou jeho,
 *   2. NEadmin s TÝMŽ příznakem dostane svou frontu — ne cizí řádky a ne chybu,
 *   3. a pozná se to z provenance (`:all`), takže čtenář ví, KTEROU množinu drží.
 *
 * Fail-closed znamená degradovat na užší pohled, ne spadnout: kdyby to házelo
 * chybu, blok by v sekci zmizel a nikdo by nevěděl proč.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const TEMPLATE = `Dispatch test ${RUN}`;
const ADMIN = randomUUID();
const DRIVER = randomUUID();

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

interface Block { data: { items: { quote?: string }[] }; provenance: { trace_id: string } }
function asUser(uid: string, extra: Record<string, unknown>): Block {
  const cfg = JSON.stringify({ step_code: "predej", quote_src: "input:dl_number", limit: 50, ...extra });
  return JSON.parse(
    psql(`{"role":"authenticated","sub":"${uid}"}`,
         `SELECT public.get_workflow_my_steps_block('${cfg}'::jsonb)`),
  ) as Block;
}

beforeAll(() => {
  if (!dbAvailable) return;
  svc(`INSERT INTO public.production_workflow_templates (name, workflow_steps, is_active)
       SELECT '${TEMPLATE}', '[{"step_code":"predej","step_name":"Predej","step_order":1}]'::jsonb, true
       WHERE NOT EXISTS (SELECT 1 FROM public.production_workflow_templates WHERE name = '${TEMPLATE}')`);
  // Běh patřící CIZÍMU člověku — ani admin, ani řidič ho nemají přiřazený.
  svc(`SELECT public.ensure_workflow_run_for_subject('${TEMPLATE}', 'disp-${RUN}-x', 'cizí',
         current_date - 30, '{"dl_number":"CIZI"}'::jsonb)`);
  // Aby test nestál na tom, KDO je v téhle DB admin: role se přiřadí explicitně.
  svc(`INSERT INTO aisha_auth.users (id, email) VALUES ('${ADMIN}','disp-admin-${RUN}@test.local'),
        ('${DRIVER}','disp-driver-${RUN}@test.local') ON CONFLICT (id) DO NOTHING`);
  svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin')
        ON CONFLICT DO NOTHING`);
});

afterAll(() => {
  if (!dbAvailable) return;
  // Pořadí: dávky drží FK na šablonu (production_batches_workflow_template_id_fkey),
  // takže šablona se maže AŽ po nich — jinak úklid spadne a test je červený
  // z důvodu, který s testovanou vlastností nemá nic společného.
  svc(`DELETE FROM public.production_batches WHERE batch_code LIKE 'disp-${RUN}-%'`);
  svc(`DELETE FROM public.production_workflow_templates WHERE name = '${TEMPLATE}'`);
  svc(`DELETE FROM public.user_roles WHERE user_id IN ('${ADMIN}','${DRIVER}')`);
});

describe("get_workflow_my_steps_block × all_assignees", () => {
  it.skipIf(!dbAvailable)("admin s příznakem vidí i cizí kroky a provenance to přizná", () => {
    const b = asUser(ADMIN, { all_assignees: true });
    expect(b.data.items.map((i) => i.quote)).toContain("CIZI");
    expect(b.provenance.trace_id).toContain(":all");
  });

  it.skipIf(!dbAvailable)("NEadmin s týmž příznakem cizí kroky NEVIDÍ — a nespadne", () => {
    const b = asUser(DRIVER, { all_assignees: true });
    expect(b.data.items.map((i) => i.quote)).not.toContain("CIZI");
    // degradace na užší pohled, ne chyba: blok musí zůstat v sekci
    expect(b.provenance.trace_id).not.toContain(":all");
  });

  it.skipIf(!dbAvailable)("bez příznaku nevidí cizí kroky ani admin — výchozí je osobní fronta", () => {
    const b = asUser(ADMIN, {});
    expect(b.data.items.map((i) => i.quote)).not.toContain("CIZI");
    expect(b.provenance.trace_id).not.toContain(":all");
  });
});
