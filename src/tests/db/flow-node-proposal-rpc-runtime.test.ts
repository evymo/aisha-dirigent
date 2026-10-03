/**
 * propose_production_flow_node — návrhové sloveso pro mapu toku z ingestu.
 *
 * Pinuje čtyři vlastnosti švu (ne pravopis):
 *  · service_role smí navrhnout a uzel vznikne NEAKTIVNÍ — neaktivita je
 *    vynucená tvarem INSERTu, žádný parametr ji neumí obejít;
 *  · idempotence podle node_code: redrain OBNOVÍ důkaz (metadata.proposal),
 *    nikdy nevyrobí druhý uzel;
 *  · ratifikovaný (aktivní) uzel se nikdy nemění — nový důkaz ho nesmí
 *    přepsat ani deaktivovat;
 *  · neaktivní uzel založený člověkem (bez metadata.proposal) se nechává být.
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

function propose(code: string, name: string, type = "process", measured = "{}"): Record<string, unknown> {
  return JSON.parse(svc(
    `SELECT public.propose_production_flow_node('${code}', '${name}', '${type}', '${measured}'::jsonb, '["place_from","place_to"]'::jsonb)`
  ));
}

const RUN = randomUUID().slice(0, 8);
const CODE = `ing-test-${RUN}`;

beforeAll(async () => {
  await reportTestCapabilities("flow-node-proposal");
});

describe("propose_production_flow_node", () => {
  it.skipIf(!dbAvailable)("service_role proposes an INACTIVE node with evidence", () => {
    const out = propose(CODE, "ŽULOVÁ", "process", '{"observations": 3165, "self_loop": 1482}');
    expect(out.ok).toBe(true);
    expect(out.created).toBe(true);
    const row = svc(
      `SELECT is_active || '|' || (metadata->'proposal'->'measured'->>'self_loop')
         FROM public.production_flow_nodes WHERE node_code = '${CODE}'`
    );
    expect(row).toBe("false|1482"); // neaktivní z tvaru, důkaz u návrhu
  });

  it.skipIf(!dbAvailable)("redrain refreshes the proposal, never duplicates", () => {
    const out = propose(CODE, "ŽULOVÁ", "storage", '{"observations": 4000}');
    expect(out.ok).toBe(true);
    expect(out.refreshed).toBe(true);
    const row = svc(
      `SELECT count(*) || '|' || min(node_type) || '|' ||
              min(metadata->'proposal'->'measured'->>'observations')
         FROM public.production_flow_nodes WHERE node_code = '${CODE}'`
    );
    expect(row).toBe("1|storage|4000"); // jeden uzel, poslední důkaz i typ
  });

  it.skipIf(!dbAvailable)("a ratified (active) node is never touched by new evidence", () => {
    svc(`UPDATE public.production_flow_nodes SET is_active = true WHERE node_code = '${CODE}'`);
    const out = propose(CODE, "PŘEJMENOVANÁ", "waste", '{"observations": 9}');
    expect(out.ok).toBe(true);
    expect(out.already_active).toBe(true);
    const row = svc(
      `SELECT node_name || '|' || node_type || '|' ||
              (metadata->'proposal'->'measured'->>'observations')
         FROM public.production_flow_nodes WHERE node_code = '${CODE}'`
    );
    expect(row).toBe("ŽULOVÁ|storage|4000"); // ratifikovaný provoz zůstal beze změny
  });

  it.skipIf(!dbAvailable)("a human-made inactive node (no proposal marker) is left alone", () => {
    const manual = `manual-${RUN}`;
    svc(`INSERT INTO public.production_flow_nodes (node_code, node_name, node_type, is_active)
         VALUES ('${manual}', 'Ruční sklad', 'storage', false)`);
    const out = propose(manual, "PŘEPIS", "process");
    expect(out.ok).toBe(true);
    expect(out.exists_unmanaged).toBe(true);
    expect(svc(`SELECT node_name FROM public.production_flow_nodes WHERE node_code = '${manual}'`))
      .toBe("Ruční sklad");
  });

  it.skipIf(!dbAvailable)("a plain authenticated user is refused (proposal is a lane verb)", () => {
    const out = JSON.parse(psql(
      `{"role":"authenticated","sub":"${randomUUID()}"}`,
      `SELECT public.propose_production_flow_node('${CODE}-x', 'X')`
    ));
    expect(out.ok).toBe(false);
    expect(String(out.error)).toMatch(/service role/);
  });
});
