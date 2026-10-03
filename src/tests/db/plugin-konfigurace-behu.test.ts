import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Konfigurace běhu pluginu se složí z domovů, kde ji platforma drží — i s pověřeními.
 *
 * ⛔ NAMĚŘENO 2026-09-16: host předával `ctx.config = {}` a `set_data_source_secrets`
 * nikdo nečetl; konektor neměl endpoint ani pověření. Test měří skutečné složení
 * nad DB: výchozí hodnota schématu → konfigurace zdroje → DEŠIFROVANÉ pověření →
 * přepis tenanta, a že tajné pole nemá výchozí hodnotu ze schématu. Běžný
 * uživatel funkci volat nesmí (vydává tajemství).
 */
const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";
const SLUG = "zz-test-konfigurace";
const TENANT = "55555555-5555-4555-8555-555555555555";
const JAKO_SLUZBA = `SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);`;

beforeAll(async () => {
  await reportTestCapabilities("konfigurace běhu pluginu");
});

describe("get_plugin_runtime_config", () => {
  it.skipIf(!dbAvailable)("složí výchozí → zdroj → dešifrované pověření → přepis tenanta", () => {
    psqlMultiline(`${HEADER}DELETE FROM public.agent_knowledge_sources WHERE source_slug = '${SLUG}';
DELETE FROM public.plugin_catalog WHERE slug = '${SLUG}';
DO $$
DECLARE v_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_id := (public.submit_plugin(
    p_artifact_sha256 := repeat('d', 64),
    p_artifact_url := 'http://minio:9000/aisha-plugins/${SLUG}/1.0.0.js',
    p_manifest := jsonb_build_object('id', '${SLUG}', 'version', '1.0.0', 'kind', 'data_source',
      'capabilities', jsonb_build_array('cron.sync'),
      'lifecycle', jsonb_build_object('load_strategy', 'hot'),
      'config_schema', jsonb_build_object('type', 'object', 'required', jsonb_build_array('apiKey'),
        'properties', jsonb_build_object(
          'endpoint', jsonb_build_object('type', 'string', 'default', 'https://vychozi.example.test'),
          'pollMinutes', jsonb_build_object('type', 'number', 'default', 5),
          'apiKey', jsonb_build_object('type', 'string', 'secret', true, 'default', 'NESMI-PROJIT'))),
      'source_spec', jsonb_build_object('namespace', 'zz-test/konfigurace', 'source_slug', '${SLUG}',
        'adapter_entry', 'dist/adapter.js', 'default_config', jsonb_build_object('rideSyncCron', '20 * * * *')))
  )->>'plugin_id')::uuid;
  UPDATE public.plugin_catalog SET status = 'approved' WHERE id = v_id;
  PERFORM public.materialize_plugin(v_id);
  -- Pole z config_schema zdroj po materializaci nezná (přenáší se jen
  -- source_spec.default_config) — správce ho přidá výslovně.
  PERFORM public.set_data_source_config('${SLUG}', jsonb_build_object('endpoint', 'https://zdroj.example.test'), p_allow_new_keys := true);
  PERFORM public.set_data_source_secrets('${SLUG}', jsonb_build_object('apiKey', 'tajne-pověření-123'));
  INSERT INTO public.plugin_tenant_overrides (plugin_id, tenant_id, enabled, config_override)
  VALUES (v_id, '${TENANT}', true, jsonb_build_object('pollMinutes', 10));
END $$;`);

    const raw = psqlQuery(`${JAKO_SLUZBA} SELECT public.get_plugin_runtime_config('${SLUG}', '${TENANT}')::text;`)
      .trim()
      .split("\n")
      .pop() ?? "{}";
    const c = JSON.parse(raw) as Record<string, unknown>;
    expect(c.endpoint, "konfigurace zdroje má přebít výchozí hodnotu schématu").toBe("https://zdroj.example.test");
    expect(c.apiKey, "pověření zdroje se musí dešifrovat — výchozí hodnota tajného pole se nebere").toBe("tajne-pověření-123");
    expect(c.pollMinutes, "přepis tenanta má přebít výchozí hodnotu").toBe(10);
    expect(c.rideSyncCron, "výchozí konfigurace konektoru ze source_spec").toBe("20 * * * *");

    const bezTenanta = JSON.parse(
      psqlQuery(`${JAKO_SLUZBA} SELECT public.get_plugin_runtime_config('${SLUG}', NULL)::text;`).trim().split("\n").pop() ?? "{}",
    ) as Record<string, unknown>;
    expect(bezTenanta.pollMinutes, "bez tenanta platí výchozí hodnota").toBe(5);
  });

  it.skipIf(!dbAvailable)("⛔ běžný přihlášený uživatel konfiguraci (s pověřeními) nedostane", () => {
    expect(() =>
      psqlQuery(
        `SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${TENANT}"}', true); SELECT public.get_plugin_runtime_config('${SLUG}', '${TENANT}');`,
      ),
    ).toThrow(/jen služba/);
    psqlMultiline(`${HEADER}DELETE FROM public.agent_knowledge_sources WHERE source_slug = '${SLUG}';
DELETE FROM public.plugin_catalog WHERE slug = '${SLUG}';`);
  });
});
