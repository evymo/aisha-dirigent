import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Zapálení rozvrhů, vynucení povolení zdroje a hlídač stavu zdrojů (2026-09-24,
 * schváleno majitelem).
 *
 * ⛔ NAMĚŘENO v produkci instance: plugin_schedules = 0 (první běh nespouštělo
 * nic → žádný plugin nikdy neběžel) a `granted_capabilities` zdroje nevynucoval
 * NIKDO (plugin by po zapálení stahoval i nepovolené polohy). Aktivní zdroj bez
 * dat týdny nikdo nehlásil.
 *
 * Měří se nad skutečnou DB: jediné „smí?" (plugin_capability_allowed) a jeho
 * dopad na reconcile i claim, výběr pluginů k zapálení (nikdy / nová verze /
 * selhání po lhůtě), nárok (běžný uživatel nesmí nic z toho) a verdikt hlídače.
 */
const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";
const SLUG = "zz-test-zapaleni";
const ZDROJ = "zz-zdroj-zapaleni";
const VLASTNIK = "77777777-7777-4777-8777-777777777777";
const STORY = "77777777-7777-4777-8777-7777777777aa";
const CIZI = "77777777-7777-4777-8777-7777777777bb";

const dotaz = (sql: string) =>
  psqlQuery(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) IS NOT NULL AND true; ${sql}`)
    .trim()
    .split("\n")
    .pop() ?? "";

/** Volání pod přihlášeným uživatelem; vrací chybu (SQLSTATE) nebo výsledek. */
const jako = (sub: string, sql: string) =>
  psqlMultiline(`BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${sub}"}', true);
DO $$ BEGIN PERFORM 1; END $$;
SELECT 'vysledek=' || (${sql});
ROLLBACK;`);

/**
 * Pokus pod přihlášeným uživatelem, který MÁ selhat. psqlMultiline vrací jen
 * stdout a bez ON_ERROR_STOP by chyba prošla jako úspěch — proto STOP a chyba
 * se čte ze stderr výjimky. Vrací text chyby, nebo 'PROSLO'.
 */
const zkusJako = (sub: string, sql: string): string => {
  try {
    psqlMultiline(`${HEADER}BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${sub}"}', true);
${sql};
ROLLBACK;`);
    return "PROSLO";
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return String(e.stderr ?? e.message ?? err);
  }
};

const pluginId = () => dotaz(`SELECT id FROM public.plugin_catalog WHERE slug = '${SLUG}';`);
const smi = (cap: string) => dotaz(`SELECT public.plugin_capability_allowed('${pluginId()}', '${cap}');`);

beforeAll(async () => {
  await reportTestCapabilities("zapálení pluginů");
  if (!dbAvailable) return;
  psqlMultiline(`${HEADER}
DELETE FROM public.agent_knowledge_sources WHERE source_slug = '${ZDROJ}';
DELETE FROM public.plugin_catalog WHERE slug = '${SLUG}';
INSERT INTO aisha_auth.users (id, email) VALUES
  ('${VLASTNIK}', 'zapaleni-vlastnik@test.local'), ('${CIZI}', 'zapaleni-cizi@test.local')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, email) VALUES
  ('${VLASTNIK}', 'zapaleni-vlastnik@test.local'), ('${CIZI}', 'zapaleni-cizi@test.local')
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${VLASTNIK}', 'admin') ON CONFLICT DO NOTHING;
INSERT INTO public.partner_stories (id, user_id, title) VALUES ('${STORY}', '${VLASTNIK}', 'zz zapálení')
ON CONFLICT (id) DO NOTHING;`);
  psqlMultiline(`${HEADER}DO $$ BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM public.submit_plugin(
    p_artifact_sha256 := repeat('d', 64),
    p_artifact_url := 'http://minio:9000/aisha-plugins/${SLUG}/1.0.0.js',
    p_manifest := jsonb_build_object('id', '${SLUG}', 'version', '1.0.0', 'kind', 'data_source',
      'capabilities', jsonb_build_array('cron.sync_a', 'cron.sync_b', 'cron.poll_positions'),
      'lifecycle', jsonb_build_object('load_strategy', 'hot')));
END $$;
UPDATE public.plugin_catalog SET status = 'ga',
  config_schema = '{"properties":{"heslo":{"type":"string","secret":true}},"required":["heslo"]}'::jsonb
 WHERE slug = '${SLUG}';
INSERT INTO public.agent_knowledge_sources (source_slug, namespace, is_active, config, source_plugin_id, story_id)
-- Aktivní zdroj musí mít onboarding (agent_knowledge_sources_activation_guard):
-- klasifikaci podle Source Onboarding Contract (source_type, data_sensitivity,
-- retention_class, legal_basis) a vlastníka — fixtura je nese jako živý zdroj.
-- (Klíče kontraktu od #1063; dřívější tvar retention/legal_basis:"test" závora odmítne.)
SELECT '${ZDROJ}', 'zz/zapaleni', true, '{"granted_capabilities":["cron.sync_a","cron.sync_b"],
  "source_type":"partner","data_sensitivity":"internal","legal_basis":"contract","owner":"test",
  "retention_class":"short_term"}'::jsonb, id, '${STORY}'
  FROM public.plugin_catalog WHERE slug = '${SLUG}';`);
});

describe("povolení zdroje: manifest říká, co plugin UMÍ, zdroj, co SMÍ", () => {
  it.skipIf(!dbAvailable)("povolená schopnost projde, nepovolená (polohy) ne; vypnutý zdroj nesmí nic", () => {
    expect(smi("cron.sync_a")).toBe("t");
    expect(smi("cron.poll_positions"), "polohy nejsou v granted_capabilities — nesmí").toBe("f");
    psqlMultiline(`${HEADER}UPDATE public.agent_knowledge_sources SET is_active = false WHERE source_slug = '${ZDROJ}';`);
    expect(smi("cron.sync_a"), "vypnutý zdroj musí zastavit i povolenou schopnost").toBe("f");
    psqlMultiline(`${HEADER}UPDATE public.agent_knowledge_sources SET is_active = true WHERE source_slug = '${ZDROJ}';`);
  });

  it.skipIf(!dbAvailable)("zdroj bez seznamu povolení nesmí nic (default deny), ne „všechno“", () => {
    psqlMultiline(`${HEADER}UPDATE public.agent_knowledge_sources SET config = config - 'granted_capabilities' WHERE source_slug = '${ZDROJ}';`);
    expect(smi("cron.sync_a")).toBe("f");
    psqlMultiline(`${HEADER}UPDATE public.agent_knowledge_sources
  SET config = config || '{"granted_capabilities":["cron.sync_a","cron.sync_b"]}'::jsonb WHERE source_slug = '${ZDROJ}';`);
    expect(smi("cron.sync_a")).toBe("t");
  });

  it.skipIf(!dbAvailable)("reconcile nezapíše nepovolenou schopnost; claim ji nezabere ani po odebrání povolení", () => {
    const r = JSON.parse(
      dotaz(`SELECT public.reconcile_plugin_schedules('${SLUG}', '${VLASTNIK}', jsonb_build_array(
        jsonb_build_object('cron', '*/5 * * * *', 'capability', 'cron.sync_a', 'next_run_at', (now() - interval '1 minute')::text),
        jsonb_build_object('cron', '0 3 * * *', 'capability', 'cron.sync_b', 'next_run_at', (now() + interval '1 hour')::text),
        jsonb_build_object('cron', '*/5 * * * *', 'capability', 'cron.poll_positions', 'next_run_at', (now() - interval '1 minute')::text)))::text;`),
    ) as { zapsano: number; odmitnuto: Array<{ duvod: string }> };
    expect(r.zapsano).toBe(2);
    expect(r.odmitnuto.map((o) => o.duvod).join(" "), "polohy musí být odmítnuté s důvodem").toContain("neudělená");

    psqlMultiline(`${HEADER}UPDATE public.agent_knowledge_sources
  SET config = jsonb_set(config, '{granted_capabilities}', '["cron.sync_b"]'::jsonb) WHERE source_slug = '${ZDROJ}';`);
    const zabrane = dotaz(`SELECT count(*) FROM public.claim_due_plugin_schedules(50, 60) WHERE plugin_slug = '${SLUG}';`);
    expect(Number(zabrane), "odebrané povolení musí zastavit i už zapsaný splatný rozvrh").toBe(0);
    psqlMultiline(`${HEADER}UPDATE public.agent_knowledge_sources
  SET config = jsonb_set(config, '{granted_capabilities}', '["cron.sync_a","cron.sync_b"]'::jsonb) WHERE source_slug = '${ZDROJ}';`);
  });
});

describe("zapálení: kdo, kdy a znovu kdy", () => {
  const vKandidatech = () =>
    dotaz(`SELECT count(*) FROM public.list_plugins_to_declare(50, 60) WHERE plugin_slug = '${SLUG}' AND tenant_id = '${VLASTNIK}';`);

  it.skipIf(!dbAvailable)("nezapálený plugin aktivního zdroje s vlastníkem je kandidát; po úspěchu se stejnou verzí už ne", () => {
    psqlMultiline(`${HEADER}DELETE FROM public.plugin_declarations WHERE plugin_id = (SELECT id FROM public.plugin_catalog WHERE slug = '${SLUG}');`);
    expect(vKandidatech()).toBe("1");
    dotaz(`SELECT public.record_plugin_declaration('${SLUG}', '${VLASTNIK}', '1.0.0', 'ok', '{"zapsano":2}'::jsonb);`);
    expect(vKandidatech(), "úspěšně zapálený plugin se nesmí zapalovat každou minutou").toBe("0");
  });

  it.skipIf(!dbAvailable)("selhání se zopakuje až po lhůtě; nová verze se zapálí hned", () => {
    dotaz(`SELECT public.record_plugin_declaration('${SLUG}', '${VLASTNIK}', '1.0.0', 'failed', '{"duvod":"test"}'::jsonb);`);
    expect(vKandidatech(), "čerstvé selhání se neopakuje hned").toBe("0");
    psqlMultiline(`${HEADER}UPDATE public.plugin_declarations SET declared_at = now() - interval '2 hours'
 WHERE plugin_id = (SELECT id FROM public.plugin_catalog WHERE slug = '${SLUG}');`);
    expect(vKandidatech(), "po lhůtě se selhání zkusí znovu").toBe("1");

    dotaz(`SELECT public.record_plugin_declaration('${SLUG}', '${VLASTNIK}', '1.0.0', 'ok', '{}'::jsonb);`);
    psqlMultiline(`${HEADER}INSERT INTO public.plugin_versions (plugin_id, version, artifact_url, artifact_sha256, created_at)
SELECT id, '1.0.1', 'http://minio:9000/aisha-plugins/${SLUG}/1.0.1.js', repeat('e', 64), now() + interval '1 second'
  FROM public.plugin_catalog WHERE slug = '${SLUG}';`);
    expect(vKandidatech(), "nová verze může deklarovat jiné rozvrhy — musí se zapálit").toBe("1");
    dotaz(`SELECT public.record_plugin_declaration('${SLUG}', '${VLASTNIK}', '1.0.1', 'ok', '{}'::jsonb);`);
  });

  it.skipIf(!dbAvailable)("zdroj bez vlastníka se nezapálí (tenant se nehádá)", () => {
    psqlMultiline(`${HEADER}UPDATE public.agent_knowledge_sources SET story_id = NULL WHERE source_slug = '${ZDROJ}';
DELETE FROM public.plugin_declarations WHERE plugin_id = (SELECT id FROM public.plugin_catalog WHERE slug = '${SLUG}');`);
    expect(dotaz(`SELECT count(*) FROM public.list_plugins_to_declare(50, 60) WHERE plugin_slug = '${SLUG}';`)).toBe("0");
    psqlMultiline(`${HEADER}UPDATE public.agent_knowledge_sources SET story_id = '${STORY}' WHERE source_slug = '${ZDROJ}';`);
    dotaz(`SELECT public.record_plugin_declaration('${SLUG}', '${VLASTNIK}', '1.0.1', 'ok', '{}'::jsonb);`);
  });

  it.skipIf(!dbAvailable)("⛔ přihlášený uživatel nesmí nic z toho — ani zapsat telemetrii", () => {
    const pid = pluginId();
    const ODMITNUTO = /42501|jen služba|permission denied/;
    expect(zkusJako(CIZI, `SELECT count(*) FROM public.list_plugins_to_declare(5, 60)`)).toMatch(ODMITNUTO);
    expect(zkusJako(CIZI, `SELECT public.record_plugin_declaration('${SLUG}', '${CIZI}', '9', 'ok', '{}'::jsonb)`)).toMatch(ODMITNUTO);
    expect(
      zkusJako(CIZI, `SELECT public.register_plugin_event(NULL, 'invoke', 1, '{}'::jsonb, '${pid}', NULL)`),
      "telemetrie byla povolená i anon — podvržený běh by hlídač přečetl jako zdravý",
    ).toMatch(ODMITNUTO);
    expect(zkusJako(CIZI, `SELECT public.plugin_capability_allowed('${pid}', 'cron.sync_a')`)).toMatch(ODMITNUTO);
    // kontrolní vzorek: měřidlo umí říct „prošlo" — jinak by vše výš prošlo i nad vadným pomocníkem
    expect(zkusJako(CIZI, `SELECT 1`)).toBe("PROSLO");
  });
});

describe("hlídač stavu zdrojů", () => {
  const radek = (sub: string) => {
    const out = jako(
      sub,
      `SELECT coalesce((SELECT r::text FROM jsonb_array_elements(public.get_data_source_feed_health_block('{}'::jsonb)->'data'->'rows') r
         WHERE r->>'zdroj' = '${ZDROJ}'), 'NULL')`,
    );
    const m = out.match(/vysledek=(.*)/);
    return m && m[1] !== "NULL" ? (JSON.parse(m[1]) as Record<string, unknown>) : null;
  };

  it.skipIf(!dbAvailable)("chybějící pověření se hlásí JMÉNEM; po doplnění zapálený zdroj bez úspěšného běhu = ticho", () => {
    expect(radek(VLASTNIK)).toMatchObject({ stav: "chybi_povereni", chybi_povereni: "heslo" });
    psqlMultiline(`${HEADER}INSERT INTO public.agent_knowledge_source_secrets (source_id, secret_key, value_enc)
SELECT id, 'heslo', 'x' FROM public.agent_knowledge_sources WHERE source_slug = '${ZDROJ}'
ON CONFLICT (source_id, secret_key) DO NOTHING;`);
    const r = radek(VLASTNIK);
    expect(r, "zdroj s rozvrhy, ale bez jediného úspěšného běhu, NESMÍ vypadat zdravě").toMatchObject({ stav: "ticho" });
    expect(r?.behu, "NEMĚŘENO ≠ 0: bez běhů je počet null").toBeNull();
    expect(JSON.stringify(r)).not.toContain('"x"');
  });

  it.skipIf(!dbAvailable)("úspěšný běh s metrem → ok a čísla (volání, odezva, stažené KB, zapsáno)", () => {
    dotaz(`SELECT public.register_plugin_event(NULL, 'invoke', 800,
      '{"capability":"cron.sync_a","trigger":"planovac","http":{"calls":4,"errors":0,"bytes_in":4096,"bytes_out":0,"ms_total":400,"ms_max":200,"hosts":{"api.x":4}},"zapsano":{"x_audited":12},"zapsano_celkem":12}'::jsonb,
      '${pluginId()}', '${VLASTNIK}');`);
    expect(radek(VLASTNIK)).toMatchObject({ stav: "ok", behu: 1, chyb: 0, volani: 4, odezva_ms: 100, stazeno_kb: 4, zapsano: 12 });
  });

  it.skipIf(!dbAvailable)("⛔ běžný uživatel nedostane nic (prázdná tabulka, ne chyba ani cizí data)", () => {
    expect(radek(CIZI)).toBeNull();
  });
});
