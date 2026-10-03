import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Schválení se PŘENÁŠÍ na nový kód, pokud nová verze nerozšiřuje oprávnění
 * (rozhodnutí majitele 2026-09-27).
 *
 * ⛔ NAMĚŘENO na instanci: každé kolo s novou verzí pluginu vrátilo T-CARS,
 * Webdispečink i AVP na `submitted` a data přestala téct, dokud někdo neklikl
 * „Schválit do provozu". Člověk schvaluje OPRÁVNĚNÍ, ne každý build.
 *
 * Měří se nad skutečnou DB tak, jak podává plugin-publish-init (správa):
 * přenos při shodných i zúžených oprávněních (canary i ga), reset při rozšíření
 * capabilities / rpc_allowlist / hostitelů / stropu zdrojů / zdroje zápisu,
 * a že servisní role ani cizí důvěra schválení nepřenese. Audit nese, CO se
 * přeneslo (verze, otisky, co se nepřezkoumalo) a PROČ se resetovalo.
 */
const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";
const SLUG = "zz-test-prenos";
const CIZI = "zz-test-prenos-external";
const ZDROJ = "zz-test-prenos-zdroj";
const SPRAVCE = "79797979-7979-4979-8979-797979797979";

const dotaz = (sql: string) =>
  psqlQuery(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) IS NOT NULL AND true; ${sql}`)
    .trim()
    .split("\n")
    .pop() ?? "";

/** Volání pod přihlášeným uživatelem v transakci, která se POTVRDÍ; vrací výsledek RPC. */
const jako = (sub: string, sql: string): string => {
  const vystup = psqlMultiline(`${HEADER}BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${sub}"}', true);
SELECT 'vysledek=' || (${sql})::text;
COMMIT;`);
  const radek = vystup.split("\n").find((r) => r.includes("vysledek="));
  return radek ? radek.slice(radek.indexOf("vysledek=") + "vysledek=".length).trim() : "";
};

type Manifest = Record<string, unknown>;
/** Výchozí oprávnění schválené verze. Každý test mění jen to, co měří. */
const zaklad = (slug: string, verze: string): Manifest => ({
  id: slug,
  version: verze,
  kind: "data_source",
  trust_tier: "internal",
  capabilities: ["cron.sync_a", "cron.sync_b"],
  sandbox: { network_allowlist: ["api.example.test"], rpc_allowlist: ["zz_a", "zz_b"], timeout_ms: 30000, max_memory_mb: 64 },
  lifecycle: { load_strategy: "hot" },
  source_spec: { source_slug: ZDROJ, namespace: "test/prenos", adapter_entry: "src/index.ts", default_config: { cron: "0 3 * * *" } },
});

let sha = 0;
const dalsiSha = () => (++sha).toString(16).padStart(64, "0");

/** Podání správou (jako plugin-publish-init s AISHA_ADMIN_JWT). */
const podatSpravou = (m: Manifest) =>
  JSON.parse(
    jako(
      SPRAVCE,
      `public.submit_plugin(p_artifact_sha256 := '${dalsiSha()}', p_artifact_url := 'http://minio:9000/aisha-plugins/${m.id}/${m.version}.js', p_manifest := '${JSON.stringify(m)}'::jsonb)`,
    ),
  ) as { status: string; schvaleni_preneseno: boolean; schvaleni_zachovano: boolean; rozsireni: string[] };

/** Podání holou servisní rolí (stroj). */
const podatStrojem = (m: Manifest) =>
  psqlMultiline(`${HEADER}DO $$ BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM public.submit_plugin(p_artifact_sha256 := '${dalsiSha()}',
    p_artifact_url := 'http://minio:9000/aisha-plugins/${m.id}/${m.version}.js', p_manifest := '${JSON.stringify(m)}'::jsonb);
END $$;`);

const stav = (slug: string) => dotaz(`SELECT status FROM public.plugin_catalog WHERE slug = '${slug}';`);
const schvalit = (slug: string) => JSON.parse(jako(SPRAVCE, `public.approve_internal_plugin('${slug}')`));
/** Poslední audit dané akce pro plugin (metadata jako objekt). */
const posledniAudit = (slug: string, akce: string) =>
  JSON.parse(
    dotaz(`SELECT COALESCE((SELECT e.metadata::text FROM public.plugin_audit_events e JOIN public.plugin_catalog pc ON pc.id = e.plugin_id
             WHERE pc.slug = '${slug}' AND e.action = '${akce}' ORDER BY e.created_at DESC, e.id DESC LIMIT 1), 'null');`),
  );

const uklid = () =>
  psqlMultiline(`${HEADER}
DELETE FROM public.agent_knowledge_sources WHERE source_slug IN ('${ZDROJ}', '${ZDROJ}-jiny');
DELETE FROM public.plugin_catalog WHERE slug IN ('${SLUG}', '${CIZI}');`);

beforeAll(async () => {
  await reportTestCapabilities("přenos schválení pluginu");
  if (!dbAvailable) return;
  uklid();
  psqlMultiline(`${HEADER}
INSERT INTO aisha_auth.users (id, email) VALUES ('${SPRAVCE}', 'prenos-spravce@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, email) VALUES ('${SPRAVCE}', 'prenos-spravce@test.local') ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${SPRAVCE}', 'admin') ON CONFLICT DO NOTHING;`);
  podatSpravou(zaklad(SLUG, "1.0.0"));
  schvalit(SLUG);
});

afterAll(() => {
  if (dbAvailable) uklid();
});

describe("přenos schválení na nový kód (oprávnění se nerozšiřují)", () => {
  it.skipIf(!dbAvailable)("výchozí stav: správa schválila 1.0.0 → canary", () => {
    expect(stav(SLUG)).toBe("canary");
  });

  it.skipIf(!dbAvailable)("nový kód + jiný výchozí rozvrh, vstupní soubor a lifecycle → schválení se PŘENESE, audit říká co a odkud", () => {
    const m = zaklad(SLUG, "1.0.1");
    m.lifecycle = { load_strategy: "hot", backend_entry: "src/novy.ts" };
    m.source_spec = { ...(m.source_spec as object), adapter_entry: "src/novy.ts", default_config: { cron: "*/30 * * * *" } };
    const r = podatSpravou(m);
    expect(r).toMatchObject({ status: "canary", schvaleni_preneseno: true, schvaleni_zachovano: true, rozsireni: [] });
    expect(stav(SLUG)).toBe("canary");
    const a = posledniAudit(SLUG, "PLUGIN_APPROVAL_CARRIED_OVER");
    expect(a).toMatchObject({ slug: SLUG, status: "canary", from_version: "1.0.0", to_version: "1.0.1" });
    expect(a.from_artifact_sha256).not.toBe(a.to_artifact_sha256);
    expect(a.zmeneno).toEqual(expect.arrayContaining(["kód", "lifecycle", "source_spec (adapter_entry/default_config)"]));
  });

  /** Zúžená oprávnění (méně capabilities, RPC, hostitelů, nižší strop). */
  const zuzeny = (verze: string): Manifest => ({
    ...zaklad(SLUG, verze),
    capabilities: ["cron.sync_a"],
    sandbox: { network_allowlist: [], rpc_allowlist: ["zz_a"], timeout_ms: 20000, max_memory_mb: 32 },
  });

  it.skipIf(!dbAvailable)("ZÚŽENÍ oprávnění (méně capabilities, RPC, hostitelů, nižší strop) → přenese se", () => {
    expect(podatSpravou(zuzeny("1.0.2"))).toMatchObject({ status: "canary", schvaleni_preneseno: true, rozsireni: [] });
  });

  it.skipIf(!dbAvailable)("i ve stavu ga se přenáší ga (ne povýšení, ne snížení)", () => {
    psqlMultiline(`${HEADER}UPDATE public.plugin_catalog SET status = 'ga' WHERE slug = '${SLUG}';`);
    // tatáž (zúžená) oprávnění jako schválená 1.0.2, jen nový kód
    expect(podatSpravou(zuzeny("1.0.3"))).toMatchObject({ status: "ga", schvaleni_preneseno: true, rozsireni: [] });
  });

  it.skipIf(!dbAvailable)("návrat k širším oprávněním po zúžení JE rozšíření → reset (zúžení se nedá obejít dvěma kroky)", () => {
    const r = podatSpravou(zaklad(SLUG, "1.0.4"));
    expect(r.status).toBe("submitted");
    expect(r.rozsireni).toEqual(expect.arrayContaining(["capabilities: +cron.sync_b", "sandbox.rpc_allowlist: +zz_b"]));
    expect(schvalit(SLUG)).toMatchObject({ status: "canary" });
  });
});

describe("rozšíření oprávnění → reset na submitted s důvodem (a jde znovu schválit)", () => {
  const pripadu: Array<[string, (m: Manifest) => void, RegExp]> = [
    ["nová capability", (m) => { m.capabilities = ["cron.sync_a", "cron.sync_b", "http.GET./x"]; }, /^capabilities: \+http\.GET\.\/x$/],
    ["nové RPC v allowlistu", (m) => { m.sandbox = { ...(m.sandbox as object), rpc_allowlist: ["zz_a", "zz_b", "zz_c"] }; }, /^sandbox\.rpc_allowlist: \+zz_c$/],
    ["nový hostitel", (m) => { m.sandbox = { ...(m.sandbox as object), network_allowlist: ["api.example.test", "jinde.example.test"] }; }, /^sandbox\.network_allowlist: \+jinde\.example\.test$/],
    ["vyšší strop zdrojů", (m) => { m.sandbox = { ...(m.sandbox as object), max_memory_mb: 512 }; }, /^sandbox\.max_memory_mb: 64 → 512$/],
    ["nový klíč sandboxu", (m) => { m.sandbox = { ...(m.sandbox as object), allow_fs: true }; }, /^sandbox\.allow_fs$/],
    ["jiný cíl zápisu (source_slug)", (m) => { m.source_spec = { ...(m.source_spec as object), source_slug: `${ZDROJ}-jiny` }; }, /^source_spec\.source_slug$/],
  ];
  let verze = 10;
  for (const [nazev, uprav, ocekavano] of pripadu) {
    it.skipIf(!dbAvailable)(`${nazev} → submitted, audit PLUGIN_APPROVAL_RESET s výčtem`, () => {
      // výchozí stav každého případu: schválená základní oprávnění
      if (stav(SLUG) !== "canary" && stav(SLUG) !== "ga") schvalit(SLUG);
      const obnova = podatSpravou(zaklad(SLUG, `1.0.${verze++}`));
      if (obnova.status === "submitted") schvalit(SLUG);
      expect(["canary", "ga"]).toContain(stav(SLUG));

      const m = zaklad(SLUG, `1.0.${verze++}`);
      uprav(m);
      const r = podatSpravou(m);
      expect(r.status, nazev).toBe("submitted");
      expect(r.schvaleni_preneseno).toBe(false);
      expect(r.rozsireni.some((x) => ocekavano.test(x)), `${nazev}: ${JSON.stringify(r.rozsireni)}`).toBe(true);
      const a = posledniAudit(SLUG, "PLUGIN_APPROVAL_RESET");
      expect(a.duvod).toBe("nová verze rozšiřuje oprávnění");
      expect((a.rozsireni as string[]).some((x) => ocekavano.test(x))).toBe(true);
      // znovu schválit jde (a vrátí se základ)
      expect(schvalit(SLUG)).toMatchObject({ status: "canary" });
    });
  }
});

describe("kdo schválení NEPŘENESE", () => {
  it.skipIf(!dbAvailable)("holá servisní role (stroj) → reset i při shodných oprávněních; důvod v auditu", () => {
    if (stav(SLUG) !== "canary") schvalit(SLUG);
    const r = podatSpravou(zaklad(SLUG, "2.0.0"));
    if (r.status !== "canary") schvalit(SLUG);
    podatStrojem(zaklad(SLUG, "2.0.1"));
    expect(stav(SLUG)).toBe("submitted");
    expect(posledniAudit(SLUG, "PLUGIN_APPROVAL_RESET").duvod).toBe("podání strojem (servisní role) schválení nepřenáší");
  });

  it.skipIf(!dbAvailable)("cizí důvěra (external) → reset i při shodných oprávněních", () => {
    const m = { ...zaklad(CIZI, "1.0.0"), trust_tier: "external", source_spec: undefined };
    podatSpravou(m);
    // external se jedním úkonem neschvaluje — přezkoumání krok po kroku simuluje přímý zápis stavu
    psqlMultiline(`${HEADER}UPDATE public.plugin_catalog SET status = 'canary' WHERE slug = '${CIZI}';`);
    const r = podatSpravou({ ...m, version: "1.0.1" });
    expect(r).toMatchObject({ status: "submitted", schvaleni_preneseno: false, rozsireni: [] });
    expect(posledniAudit(CIZI, "PLUGIN_APPROVAL_RESET").duvod).toBe("důvěra není internal");
  });

  it.skipIf(!dbAvailable)("shodné podání (týž kód) dál schválení ZACHOVÁ bez auditu přenosu", () => {
    schvalit(SLUG);
    const pred = dotaz(`SELECT count(*) FROM public.plugin_audit_events e JOIN public.plugin_catalog pc ON pc.id = e.plugin_id
                         WHERE pc.slug = '${SLUG}' AND e.action = 'PLUGIN_APPROVAL_CARRIED_OVER';`);
    // stejný manifest i otisk jako poslední verze → v_beze_zmeny
    const posledni = JSON.parse(dotaz(`SELECT json_build_object('v', pv.version, 's', pv.artifact_sha256)::text FROM public.plugin_versions pv
                                         JOIN public.plugin_catalog pc ON pc.id = pv.plugin_id WHERE pc.slug = '${SLUG}'
                                         ORDER BY pv.created_at DESC LIMIT 1;`));
    const m = zaklad(SLUG, posledni.v);
    const r = JSON.parse(jako(SPRAVCE, `public.submit_plugin(p_artifact_sha256 := '${posledni.s}', p_artifact_url := 'http://minio:9000/aisha-plugins/${SLUG}/${posledni.v}.js', p_manifest := '${JSON.stringify(m)}'::jsonb)`));
    expect(r).toMatchObject({ status: "canary", schvaleni_zachovano: true, schvaleni_preneseno: false });
    const po = dotaz(`SELECT count(*) FROM public.plugin_audit_events e JOIN public.plugin_catalog pc ON pc.id = e.plugin_id
                       WHERE pc.slug = '${SLUG}' AND e.action = 'PLUGIN_APPROVAL_CARRIED_OVER';`);
    expect(po).toBe(pred);
  });
});
