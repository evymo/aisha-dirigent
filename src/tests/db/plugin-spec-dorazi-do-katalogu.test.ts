import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Podání pluginu musí donést spec TOHO druhu, kterým plugin je.
 *
 * ⛔ NAMĚŘENO 2026-09-06 v RIQ produkci. Tři pluginy `kind=data_source` se
 * publikovaly, došly katalogem až do `ga` — a z ingestu nevyšlo NIC. Řetěz se
 * přetrhl potichu uprostřed: `submit_plugin` zapisoval z manifestu jediný spec
 * (`agent_spec`), takže `plugin_catalog.source_spec` zůstal NULL a
 * `materialize_data_source` skončila `{skipped: 'no source_spec'}`. Následek:
 * zdroj `webdispecink-fleet` byl `is_active = true` BEZ vykonavatele,
 * `plugin_schedules` prázdné, tabulky flotily prázdné.
 *
 * ⭐ PROČ STATICKÁ BRÁNA NESTAČÍ. `plugin-kind-has-materializer` hlídá, že každý
 * druh MÁ materializátor — a ten tu byl. Vada je v HODNOTĚ, kterou zápis do
 * katalogu nedonese, takže ji vydá až běh proti databázi.
 *
 * ⭐ MĚŘÍ SE CELÝ ŘETĚZ, ne jen sloupec: podání → katalog → `ga` → napojený
 * zdroj. Kdyby se měřil jen `source_spec is not null`, prošla by i verze, kde
 * materializace spadne z jiného důvodu.
 */
const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";
const SLUG = "zz-test-source-spec";

beforeAll(async () => {
  await reportTestCapabilities("plugin spec dorazí do katalogu");
});

describe("podání pluginu donese spec svého druhu", () => {
  it.skipIf(!dbAvailable)("data_source: source_spec dorazí a v `ga` se zdroj napojí", () => {
    const out = psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_id  uuid;
  v_res jsonb;
  v_spec jsonb;
  v_zdroju int;
BEGIN
  DELETE FROM public.agent_knowledge_sources WHERE source_slug = '${SLUG}';
  DELETE FROM public.plugin_catalog WHERE slug = '${SLUG}';

  -- Podání servisní rolí — týž vzor, jakým publikuje nasazení.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_res := public.submit_plugin(
    p_artifact_sha256 := repeat('a', 64),
    p_artifact_url := 'http://minio:9000/aisha-plugins/${SLUG}/0.0.1.js',
    p_manifest := jsonb_build_object(
      'id', '${SLUG}', 'version', '0.0.1', 'kind', 'data_source',
      'name', 'ZZ Source Spec',
      'source_spec', jsonb_build_object(
        'namespace', 'zz-test/source-spec',
        'source_slug', '${SLUG}',
        'adapter_entry', 'dist/adapter.js')));
  -- submit_plugin nevrací success (na rozdíl od transition_plugin_status);
  -- důkazem podání je vydané plugin_id.
  IF v_res->>'plugin_id' IS NULL THEN
    RAISE EXCEPTION 'podání selhalo: %', v_res::text;
  END IF;
  v_id := (v_res->>'plugin_id')::uuid;

  SELECT source_spec INTO v_spec FROM public.plugin_catalog WHERE id = v_id;
  IF v_spec IS NULL THEN
    RAISE EXCEPTION 'source_spec se do katalogu NEDONESL — materializace ho tiše přeskočí a z ingestu nevyleze nic';
  END IF;

  -- Cesta do provozu: materializace visí na canary/ga.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  UPDATE public.plugin_catalog SET status = 'approved' WHERE id = v_id;
  PERFORM public.materialize_plugin(v_id);

  SELECT count(*) INTO v_zdroju FROM public.agent_knowledge_sources
   WHERE source_slug = '${SLUG}' AND source_plugin_id = v_id;
  IF v_zdroju <> 1 THEN
    RAISE EXCEPTION 'zdroj se nenapojil na vykonavatele (nalezeno %) — zapnutý zdroj bez pluginu je přesně ten tichý stav z 2026-09-06', v_zdroju;
  END IF;

END $$;`);
    expect(out, `podání/materializace neproběhly:\n${out}`).toContain("DO");

    // ⭐ Tvrzení patří sem, ne do RAISE uvnitř bloku: `psqlMultiline` sbírá jen
    // stdout, kdežto NOTICE jde na stderr — zelená by pak znamenala „nevidím",
    // ne „prošlo". Naměřeno 2026-09-06, když blok doběhl a test přesto padal.
    const maSpec = psqlQuery(
      `SELECT (source_spec IS NOT NULL) FROM public.plugin_catalog WHERE slug = '${SLUG}'`,
    ).trim();
    expect(
      maSpec,
      "source_spec se do katalogu NEDONESL — materialize_data_source ho tiše přeskočí " +
        "({skipped: 'no source_spec'}) a z ingestu nevyleze nic",
    ).toBe("t");

    const napojenych = psqlQuery(
      `SELECT count(*) FROM public.agent_knowledge_sources s ` +
        `JOIN public.plugin_catalog p ON p.id = s.source_plugin_id ` +
        `WHERE p.slug = '${SLUG}'`,
    ).trim();
    expect(
      Number(napojenych),
      "zdroj se nenapojil na vykonavatele — zapnutý zdroj bez pluginu je přesně " +
        "ten tichý stav z 2026-09-06 (webdispecink-fleet: is_active, source_plugin_id NULL)",
    ).toBe(1);

    psqlMultiline(
      `${HEADER}DELETE FROM public.agent_knowledge_sources WHERE source_slug = '${SLUG}';\n` +
        `DELETE FROM public.plugin_catalog WHERE slug = '${SLUG}';`,
    );
  });

  it.skipIf(!dbAvailable)("měřidlo má co měřit — katalog nese sloupce pro všechny druhy", () => {
    // Kdyby sloupce zmizely, test výš by padal z jiného důvodu a vypadalo by to
    // jako vada zápisu. Tohle odděluje „chybí sloupec" od „nikdo ho neplní".
    const n = psqlQuery(
      "SELECT count(*) FROM information_schema.columns " +
        "WHERE table_name = 'plugin_catalog' AND column_name LIKE '%_spec'",
    );
    expect(Number(n), "plugin_catalog nemá spec sloupce pro jednotlivé druhy").toBeGreaterThanOrEqual(6);
  });
});
