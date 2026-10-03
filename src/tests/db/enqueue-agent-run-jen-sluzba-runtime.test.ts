import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * enqueue_agent_run volá JEN služba (service_role) — ne přihlášený uživatel.
 *
 * ⛔ NAMĚŘENO 2026-09-27 na instanci: funkce byla udělená `authenticated`, ne
 * `service_role`. svc-agent-runner ji volá služebním tokenem → 403 → každý běh
 * pluginu končil „Agent runner error 500". A přihlášený uživatel si mohl přímo
 * zařadit běh s VLASTNÍM obrazem (`p_image`), který poller runneru spouští.
 *
 * Měří se nad skutečnou DB: služba zařadí, uživatel ani anon ne.
 */
const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";
const UZIVATEL = "81818181-8181-4818-8818-818181818181";
const SOURCE = "zz-test-enqueue-sluzba";

const dotaz = (sql: string) =>
  psqlQuery(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) IS NOT NULL AND true; ${sql}`)
    .trim()
    .split("\n")
    .pop() ?? "";

/** Pokus pod danou rolí, který MÁ selhat; vrací text chyby, nebo 'PROSLO'. */
const zkus = (role: "authenticated" | "anon", sql: string): string => {
  const claims = role === "authenticated" ? `{"role":"authenticated","sub":"${UZIVATEL}"}` : `{"role":"anon"}`;
  try {
    psqlMultiline(`${HEADER}BEGIN;
SET LOCAL ROLE ${role};
SELECT set_config('request.jwt.claims', '${claims}', true);
${sql};
ROLLBACK;`);
    return "PROSLO";
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return String(e.stderr ?? e.message ?? err);
  }
};

const ZARAD = `SELECT public.enqueue_agent_run('plugin-exec', 'docker', 'zz/obraz:1', '${SOURCE}', NULL)`;

beforeAll(async () => {
  await reportTestCapabilities("enqueue_agent_run jen služba");
  if (!dbAvailable) return;
  psqlMultiline(`${HEADER}
INSERT INTO aisha_auth.users (id, email) VALUES ('${UZIVATEL}', 'enqueue-uzivatel@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, email) VALUES ('${UZIVATEL}', 'enqueue-uzivatel@test.local') ON CONFLICT (user_id) DO NOTHING;`);
});

afterAll(() => {
  if (dbAvailable) psqlMultiline(`${HEADER}DELETE FROM public.agent_runs WHERE source = '${SOURCE}';`);
});

describe("enqueue_agent_run: zařadit běh smí jen služba", () => {
  it.skipIf(!dbAvailable)("služba (service_role) zařadí běh pluginu a dostane jeho id", () => {
    const id = dotaz(`${ZARAD};`);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(dotaz(`SELECT image FROM public.agent_runs WHERE id = '${id}';`)).toBe("zz/obraz:1");
  });

  it.skipIf(!dbAvailable)("přihlášený uživatel NEzařadí nic — ani s vlastním obrazem", () => {
    const pred = dotaz(`SELECT count(*) FROM public.agent_runs WHERE source = '${SOURCE}';`);
    const chyba = zkus("authenticated", ZARAD);
    expect(chyba).not.toBe("PROSLO");
    expect(chyba).toMatch(/permission denied for function enqueue_agent_run/);
    expect(dotaz(`SELECT count(*) FROM public.agent_runs WHERE source = '${SOURCE}';`)).toBe(pred);
  });

  it.skipIf(!dbAvailable)("anon taky ne", () => {
    expect(zkus("anon", ZARAD)).toMatch(/permission denied for function enqueue_agent_run/);
  });

  it.skipIf(!dbAvailable)("granty: service_role ano, authenticated ani anon ne", () => {
    const g = dotaz(`SELECT has_function_privilege('service_role', 'public.enqueue_agent_run(text,text,text,text,text)', 'execute')::text || ','
                        || has_function_privilege('authenticated', 'public.enqueue_agent_run(text,text,text,text,text)', 'execute')::text || ','
                        || has_function_privilege('anon', 'public.enqueue_agent_run(text,text,text,text,text)', 'execute')::text;`);
    expect(g).toBe("true,false,false");
  });
});
