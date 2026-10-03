/**
 * Ratifikační fronta mapy toku — get_flow_node_queue × submit_evidence_review_audited.
 *
 * Pinuje vlastnosti, na kterých fronta stojí (ne pravopis polí):
 *  · fronta ukazuje jen NEROZHODNUTÉ návrhy INGESTU, řazené podle síly důkazu
 *    (s stovkami míst je abecedа k ničemu — lom se ztratí mezi rozvozy);
 *  · schválení je to, co uzel PUSTÍ DO PROVOZU (is_active), tedy přesně akt,
 *    který návrhové sloveso z principu neumí;
 *  · zamítnutý návrh se NEVRACÍ ani po dalším drainu — jinak by člověk
 *    donekonečna rozhodoval o týchž místech a fronta by nezkonvergovala;
 *  · ruční uzel (bez proposal markeru) ve frontě nikdy není;
 *  · neprivilegovaný uživatel dostane PRÁZDNOU frontu, ne výjimku (blok nesmí 500).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();

function psql(claims: string | null, sql: string): string {
  const pre = claims === null ? "" : `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n\\o\n`;
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    { encoding: "utf8", input: `${pre}${sql};`, env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  ).trim();
}

const svc = (sql: string) => psql('{"role":"service_role"}', sql);
/**
 * Reviewer = admin/staff. ⛔ is_admin_or_staff() NENÍ stub (dřívější předpoklad
 * tohoto souboru): v throwaway DB je to skutečná funkce nad user_roles, takže bez
 * řádku role dostal REVIEWER prázdnou frontu (přesně podle kontraktu posledního
 * testu) a ratifikaci „reviewer role required“. Roli mu proto fixtura dává.
 */
const staff = (sql: string) => psql(`{"role":"authenticated","sub":"${REVIEWER}"}`, sql);

const RUN = randomUUID().slice(0, 8);
const REVIEWER = randomUUID();
const WEAK = `ing-q-weak-${RUN}`;
const STRONG = `ing-q-strong-${RUN}`;
const MANUAL = `manual-q-${RUN}`;

function propose(code: string, name: string, observations: number): void {
  svc(`SELECT public.propose_production_flow_node('${code}', '${name}', 'process',
        '{"observations": ${observations}, "in": 10, "out": 12, "self_loop": 3, "role": "hub"}'::jsonb,
        '["place_from","place_to"]'::jsonb)`);
}

function queue(): Array<{ id: string; title: string; state: string }> {
  return JSON.parse(staff(`SELECT public.get_flow_node_queue('{}'::jsonb)`)).data.items;
}

const mine = (items: Array<{ title: string }>) =>
  items.filter((i) => i.title.endsWith(RUN)).map((i) => i.title);

beforeAll(async () => {
  await reportTestCapabilities("flow-node-queue");
  if (!dbAvailable) return;
  svc(`INSERT INTO aisha_auth.users (id, email) VALUES ('${REVIEWER}', 'reviewer-${RUN}@test.local') ON CONFLICT DO NOTHING`);
  svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${REVIEWER}', 'staff') ON CONFLICT DO NOTHING`);
  propose(WEAK, `SLABY-${RUN}`, 12);
  propose(STRONG, `SILNY-${RUN}`, 3165);
  svc(`INSERT INTO public.production_flow_nodes (node_code, node_name, node_type, is_active)
       VALUES ('${MANUAL}', 'RUCNI-${RUN}', 'storage', false)`);
});

describe("get_flow_node_queue × submit_evidence_review_audited", () => {
  it.skipIf(!dbAvailable)("queues only ingest proposals, strongest evidence first", () => {
    const items = queue();
    expect(mine(items)).toEqual([`SILNY-${RUN}`, `SLABY-${RUN}`]); // podle důkazu, ne abecedy
    expect(items.every((i) => i.state === "needs_review")).toBe(true);
    const strong = items.find((i) => i.title === `SILNY-${RUN}`)!;
    const byKey = Object.fromEntries(
      (strong as unknown as { fields: Array<{ key: string; value: string }> }).fields.map((f) => [f.key, f.value]),
    );
    expect(byKey.observations).toBe("3165"); // důkaz jede s položkou — bez něj se ratifikuje naslepo
    expect(byKey.in_out).toBe("10 / 12");
  });

  it.skipIf(!dbAvailable)("a hand-made node is never presented as a machine proposal", () => {
    expect(mine(queue())).not.toContain(`RUCNI-${RUN}`);
  });

  it.skipIf(!dbAvailable)("approval is what puts the node into production", () => {
    const id = queue().find((i) => i.title === `SILNY-${RUN}`)!.id;
    const out = JSON.parse(
      staff(`SELECT public.submit_evidence_review_audited('flow_node', '${id}'::uuid, 'confirmed', 'ratifikace v testu')`),
    );
    expect(out.state).toBe("approved");
    expect(svc(`SELECT is_active FROM public.production_flow_nodes WHERE node_code='${STRONG}'`)).toBe("t");
    expect(mine(queue())).not.toContain(`SILNY-${RUN}`); // rozhodnuté mizí z fronty
  });

  it.skipIf(!dbAvailable)("a rejected proposal does NOT return after the next drain", () => {
    const id = queue().find((i) => i.title === `SLABY-${RUN}`)!.id;
    const out = JSON.parse(
      staff(`SELECT public.submit_evidence_review_audited('flow_node', '${id}'::uuid, 'rejected', 'jednorázové místo')`),
    );
    expect(out.state).toBe("rejected");
    expect(svc(`SELECT is_active FROM public.production_flow_nodes WHERE node_code='${WEAK}'`)).toBe("f");

    propose(WEAK, `SLABY-${RUN}`, 99); // další běh ingestu s čerstvým měřením
    expect(
      svc(`SELECT metadata->'proposal'->'measured'->>'observations'
             FROM public.production_flow_nodes WHERE node_code='${WEAK}'`),
    ).toBe("99"); // důkaz se obnovil…
    expect(mine(queue())).not.toContain(`SLABY-${RUN}`); // …ale verdikt přežil (fronta konverguje)
  });

  it.skipIf(!dbAvailable)("a non-staff caller gets an empty queue, not an exception", () => {
    const out = JSON.parse(
      psql(`{"role":"authenticated","sub":"${randomUUID()}","is_staff":false}`,
           `SELECT public.get_flow_node_queue('{}'::jsonb)`),
    );
    expect(Array.isArray(out.data.items)).toBe(true);
    expect(out.data.entity_kind).toBe("flow_node");
  });
});
