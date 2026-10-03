import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * VLASTNICTVÍ ZÁZNAMŮ v upsertech s globálním klíčem — real-DB runtime test
 * (throwaway PG přes `npm run test:db`).
 *
 * ⛔ Třída (2026-09-29, sken forku + Aisha Guru): `ON CONFLICT (<globální klíč>) DO UPDATE`
 * přepsal vlastníka nebo cíl CIZÍHO záznamu. Tvrdí se pro čtyři funkce:
 *   · twin_upsert_parameter_definitions_audited — kód jiného zdroje → 42501, i v dávce
 *     s vlastním kódem (nic se nezapíše); vlastní kód → update;
 *   · upsert_web_push_subscription — cizí endpoint se znalostí JEN endpointu → 42501;
 *     týž prohlížeč (shodné p256dh + auth) po odhlášení A a přihlášení B → převezme;
 *   · upsert_integration_service — jiný `managed_by` → 42501; nová `base_url` bez tokenu
 *     → token NULL (nepřevezme se), stejná URL → token zůstává;
 *   · aisha_register_mcp_server — jiný vlastník → 42501; nový endpoint bez znovu
 *     deklarované vazby → `auth_env_var` NULL a `status` 'discovered', takže
 *     aisha_test_mcp_server token NEPOŠLE; znovu deklarovaná vazba → pošle.
 * Každý případ běží ve VRÁCENÉ transakci — v DB nic nezůstane.
 */

const dbAvailable = isPgReachable();
const RUN = `${process.pid}-${Date.now()}`;
const ZNACKA = "@@ODPOVED@@";

beforeAll(async () => {
  await reportTestCapabilities("vlastnictví upsertů");
});

function admin(): string {
  const a = psqlQuery(`select user_id from public.user_roles where role in ('admin','staff') order by user_id limit 1`);
  expect(a, "fixture: no admin/staff user seeded").toMatch(/^[0-9a-f-]{36}$/);
  return a;
}

/** Jako `sub` (authenticated). Uvnitř téže transakce se dá přepnout dalším `jako()`. */
const jako = (sub: string) =>
  `select set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated"}', true); ` +
  `select set_config('request.jwt.claim.sub', '${sub}', true); `;

/** Jedna vrácená transakce: `priprava` jako vlastník, `kroky` pod rolí authenticated, `zaver` jako vlastník. */
function transakce(priprava: string, kroky: string, zaver: string): Record<string, unknown> {
  const out = psqlQuery(
    `begin; ${priprava} set local role authenticated; ${kroky} reset role; ` +
      `select '${ZNACKA}' || (${zaver})::text; rollback;`,
  );
  const radek = out.split("\n").map((r) => r.trim()).find((r) => r.startsWith(ZNACKA));
  if (!radek) throw new Error(`ve výstupu psql chybí odpověď: ${out.slice(0, 400)}`);
  return JSON.parse(radek.slice(ZNACKA.length)) as Record<string, unknown>;
}

/** Zachytí chybu volání do `th.<klic>` jako „SQLSTATE zpráva", jinak 'NEPADLO'. */
const zachyt = (klic: string, volani: string) =>
  `do $$ begin perform ${volani}; perform set_config('th.${klic}', 'NEPADLO', true); ` +
  `exception when others then perform set_config('th.${klic}', SQLSTATE || ' ' || SQLERRM, true); end $$; `;
const chyba = (klic: string) => `current_setting('th.${klic}')`;

/** Čtení uprostřed kroků jako vlastník (RLS by volajícímu cizí řádek skryla), pak zpět do role authenticated. */
const zmer = (klic: string, dotaz: string) =>
  `reset role; select set_config('th.${klic}', coalesce((${dotaz})::text, '<NULL>'), true); set local role authenticated; `;

/** Uživatel v aisha_auth (+ volitelně role správce) — jako vlastník, v transakci. */
const uzivatel = (id: string, spravce = false) =>
  `insert into aisha_auth.users (id, email) values ('${id}', 'vl-${id.slice(0, 8)}@test.local'); ` +
  (spravce ? `insert into public.user_roles (user_id, role) values ('${id}', 'admin'); ` : "");

describe("twin_upsert_parameter_definitions_audited — kód patří zdroji", () => {
  const kod = `test.vlastnictvi_${RUN.replace(/-/g, "_")}`;
  const def = (zdroj: string, nazev: string, code = kod) =>
    `'[{"code":"${code}","name":"${nazev}","entityType":"vehicle","dataType":"text","source":"${zdroj}"}]'::jsonb`;

  it.skipIf(!dbAvailable)("⛔ cizí zdroj kód nepřevezme (42501 s kódem a vlastníkem); vlastní zdroj aktualizuje", () => {
    const v = transakce(
      "",
      jako(admin()) +
        `select public.twin_upsert_parameter_definitions_audited(${def("zdroj-a", "Puvodni")}); ` +
        zachyt("cizi", `public.twin_upsert_parameter_definitions_audited(${def("zdroj-b", "Prevzato")})`) +
        zachyt("vlastni", `public.twin_upsert_parameter_definitions_audited(${def("zdroj-a", "Prejmenovano")})`),
      `jsonb_build_object('cizi', ${chyba("cizi")}, 'vlastni', ${chyba("vlastni")},
         'radek', (select jsonb_build_object('source', source, 'name', name) from public.twin_parameter_definitions where code = '${kod}'))`,
    );
    expect(v.cizi).toMatch(new RegExp(`^42501 parameter definition ${kod.replace(/\./g, "\\.")} belongs to source zdroj-a`));
    expect(v.vlastni).toBe("NEPADLO");
    expect(v.radek).toEqual({ source: "zdroj-a", name: "Prejmenovano" });
  });

  it.skipIf(!dbAvailable)("⛔ dávka s vlastním novým a cizím kódem neprojde celá — nový kód nevznikne", () => {
    const novy = `${kod}_novy`;
    const v = transakce(
      "",
      jako(admin()) +
        `select public.twin_upsert_parameter_definitions_audited(${def("zdroj-a", "A")}); ` +
        zachyt("davka", `public.twin_upsert_parameter_definitions_audited(
          '[{"code":"${novy}","name":"N","entityType":"vehicle","dataType":"text","source":"zdroj-b"},
            {"code":"${kod}","name":"X","entityType":"vehicle","dataType":"text","source":"zdroj-b"}]'::jsonb)`),
      `jsonb_build_object('davka', ${chyba("davka")},
         'novy', (select count(*) from public.twin_parameter_definitions where code = '${novy}'))`,
    );
    expect(v.davka).toMatch(/^42501 /);
    expect(v.novy).toBe(0);
  });
});

describe("upsert_web_push_subscription — endpoint patří držiteli subscription", () => {
  const sub = (endpoint: string, p256dh: string, auth: string) =>
    `'{"endpoint":"${endpoint}","keys":{"p256dh":"${p256dh}","auth":"${auth}"}}'::jsonb`;

  it.skipIf(!dbAvailable)("⛔ kdo zná jen endpoint, cizí subscription nepřevezme; týž prohlížeč (shodné klíče) ano; vlastník aktualizuje", () => {
    const a = randomUUID();
    const b = randomUUID();
    const e = `https://push.example.invalid/${RUN}/${a.slice(0, 8)}`;
    const v = transakce(
      uzivatel(a) + uzivatel(b),
      jako(a) +
        `select public.upsert_web_push_subscription(${sub(e, "KLIC-A", "AUTH-A")}); ` +
        jako(b) +
        zachyt("jen_endpoint", `public.upsert_web_push_subscription(${sub(e, "KLIC-UTOCNIK", "AUTH-UTOCNIK")})`) +
        zmer("po_utoku", `select user_id from public.web_push_subscriptions where endpoint = '${e}'`) +
        zachyt("tyz_prohlizec", `public.upsert_web_push_subscription(${sub(e, "KLIC-A", "AUTH-A")})`) +
        zmer("po_prepnuti", `select user_id from public.web_push_subscriptions where endpoint = '${e}'`) +
        zachyt("vlastnik_nove_klice", `public.upsert_web_push_subscription(${sub(e, "KLIC-B2", "AUTH-B2")})`),
      `jsonb_build_object('jen_endpoint', ${chyba("jen_endpoint")},
         'po_utoku', current_setting('th.po_utoku') = '${a}',
         'tyz_prohlizec', ${chyba("tyz_prohlizec")},
         'po_prepnuti', current_setting('th.po_prepnuti') = '${b}',
         'vlastnik_nove_klice', ${chyba("vlastnik_nove_klice")},
         'klic', (select p256dh from public.web_push_subscriptions where endpoint = '${e}'))`,
    );
    expect(v.jen_endpoint).toMatch(/^42501 push endpoint belongs to another user/);
    expect(v.po_utoku).toBe(true); // útok nic nezměnil
    expect(v.tyz_prohlizec).toBe("NEPADLO");
    expect(v.po_prepnuti).toBe(true);
    expect(v.vlastnik_nove_klice).toBe("NEPADLO");
    expect(v.klic).toBe("KLIC-B2");
  });
});

describe("upsert_integration_service — správce a token", () => {
  const sluzba = `vl-test-${RUN}`;
  const volej = (spravce: string, url: string, token: string | null) =>
    `public.upsert_integration_service('${sluzba}', 'Test', 'observability', '${url}', ${token === null ? "NULL" : `'${token}'`}, '{}'::jsonb, '${spravce}')`;
  const token = `select api_token from public.integration_services where service_name = '${sluzba}'`;

  it.skipIf(!dbAvailable)("⛔ jiný správce → 42501; nová URL bez tokenu → token NULL; stejná URL → token zůstává; nová URL s tokenem → nový", () => {
    const v = transakce(
      "",
      jako(admin()) +
        `select ${volej("aisha", "https://a.example.invalid", "T1")}; ` +
        zachyt("cizi_spravce", volej("manual", "https://a.example.invalid", "T9")) +
        zmer("t_po_utoku", token) +
        `select ${volej("aisha", "https://b.example.invalid", null)}; ` +
        zmer("t_nova_url", token) +
        `select ${volej("aisha", "https://b.example.invalid", "T2")}; ` +
        `select ${volej("aisha", "https://b.example.invalid", null)}; ` +
        zmer("t_stejna_url", token) +
        `select ${volej("aisha", "https://c.example.invalid", "T3")}; ` +
        zmer("t_nova_s_tokenem", token),
      `jsonb_build_object('cizi_spravce', ${chyba("cizi_spravce")},
         't_po_utoku', current_setting('th.t_po_utoku'), 't_nova_url', current_setting('th.t_nova_url'),
         't_stejna_url', current_setting('th.t_stejna_url'), 't_nova_s_tokenem', current_setting('th.t_nova_s_tokenem'),
         'spravce', (select managed_by from public.integration_services where service_name = '${sluzba}'))`,
    );
    expect(v.cizi_spravce).toMatch(new RegExp(`^42501 integration service ${sluzba} is managed by aisha`));
    expect(v.t_po_utoku).toBe("T1");
    expect(v.t_nova_url).toBe("<NULL>"); // cizí URL token nedostane
    expect(v.t_stejna_url).toBe("T2");
    expect(v.t_nova_s_tokenem).toBe("T3");
    expect(v.spravce).toBe("aisha");
  });
});

describe("aisha_register_mcp_server — vlastník a vazba na tajemství", () => {
  const slug = `vl-mcp-${RUN}`;
  const registruj = (url: string, envVar: string | null) =>
    `public.aisha_register_mcp_server('${slug}', 'Test MCP', 'http', '${url}', NULL, 'bearer', ${envVar === null ? "NULL" : `'${envVar}'`})`;
  const radekSql = `select jsonb_build_object('env', auth_env_var, 'status', status, 'url', endpoint_url) from public.mcp_server_registry where slug = '${slug}'`;
  const radek = `(${radekSql})`;
  const testEnv = `(public.aisha_test_mcp_server('${slug}')->'payload'->>'auth_env_var')`;

  it.skipIf(!dbAvailable)("stejný cíl: vazba i status zůstanou; NOVÝ endpoint bez deklarace → env NULL + discovered a test token NEPOŠLE; znovu deklarovaná → pošle", () => {
    const v = transakce(
      "",
      jako(admin()) +
        `select ${registruj("https://mcp-a.example.invalid", "VAR_A")}; ` +
        // server se mezitím schválil (jako by prošel testem) — přímo, vlastníkem nelze v roli authenticated
        `reset role; update public.mcp_server_registry set status = 'enabled' where slug = '${slug}'; set local role authenticated; ` +
        jako(admin()) +
        `select ${registruj("https://mcp-a.example.invalid", null)}; ` +
        zmer("stejny", radekSql) +
        `select ${registruj("https://mcp-utok.example.invalid", null)}; ` +
        zmer("novy", radekSql) +
        `select set_config('th.test_novy', coalesce(${testEnv}, '<NULL>'), true); ` +
        `select ${registruj("https://mcp-b.example.invalid", "VAR_B")}; ` +
        `select set_config('th.test_deklarovany', coalesce(${testEnv}, '<NULL>'), true); `,
      `jsonb_build_object('stejny', current_setting('th.stejny')::jsonb, 'novy', current_setting('th.novy')::jsonb,
         'test_novy', current_setting('th.test_novy'), 'test_deklarovany', current_setting('th.test_deklarovany'))`,
    );
    expect(v.stejny).toEqual({ env: "VAR_A", status: "enabled", url: "https://mcp-a.example.invalid" });
    expect(v.novy).toEqual({ env: null, status: "discovered", url: "https://mcp-utok.example.invalid" });
    expect(v.test_novy).toBe("<NULL>"); // test token na nový endpoint neposílá
    expect(v.test_deklarovany).toBe("VAR_B");
  });

  it.skipIf(!dbAvailable)("⛔ jiný správce cizí registraci nezmění (42501); endpoint i vazba zůstanou", () => {
    const druhy = randomUUID();
    const v = transakce(
      uzivatel(druhy, true),
      jako(admin()) +
        `select ${registruj("https://mcp-a.example.invalid", "VAR_A")}; ` +
        jako(druhy) +
        zachyt("cizi", registruj("https://mcp-utok.example.invalid", "VAR_UTOK")),
      `jsonb_build_object('cizi', ${chyba("cizi")}, 'radek', ${radek})`,
    );
    expect(v.cizi).toMatch(new RegExp(`^42501 MCP server ${slug} is registered by another owner`));
    expect(v.radek).toEqual({ env: "VAR_A", status: "discovered", url: "https://mcp-a.example.invalid" });
  });
});
