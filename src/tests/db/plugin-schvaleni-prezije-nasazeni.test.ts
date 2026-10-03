import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Schválení pluginu přežije opakované podání téhož — a NEPŘEŽIJE změnu, kterou
 * člověk neschvaloval.
 *
 * ⛔ NAMĚŘENO 2026-09-16: `submit_plugin` měl v ON CONFLICT natvrdo
 * `status = 'submitted'`. `plugin-publish-init` ho volá při KAŽDÉM nasazení core,
 * takže schválený plugin (canary/ga) po každém deployi spadl zpět, katalog
 * (`get_available_plugins` vydává jen canary/ga) ho přestal vydávat a /execute
 * vracel 404.
 *
 * ⛔ Reset ale nebyl jen vada: katalog servíruje NEJNOVĚJŠÍ verzi a
 * `plugin_versions` ON CONFLICT přepíše artefakt. Test proto měří obě strany:
 * shodné podání schválení drží; změna capabilities nebo KÓDU (jiný otisk téže
 * verze) ho ruší.
 */
const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";
// ⛔ Vlastní slug (2026-09-27): se slugem „zz-test-schvaleni" sdílel plugin s
// plugin-schvaleni-runtime.test.ts a první test ho maže (DELETE) — vitest pouští DB
// soubory souběžně, takže si oba přepisovaly stav a výsledek závisel na pořadí.
const SLUG = "zz-test-schvaleni-prezije";

function podani(opts: { sha: string; capabilities: string[]; description?: string }): void {
  const caps = `jsonb_build_array(${opts.capabilities.map((c) => `'${c}'`).join(", ")})`;
  psqlMultiline(`${HEADER}DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM public.submit_plugin(
    p_artifact_sha256 := '${opts.sha}',
    p_artifact_url := 'http://minio:9000/aisha-plugins/${SLUG}/1.0.0.js',
    p_manifest := jsonb_build_object(
      'id', '${SLUG}', 'version', '1.0.0', 'kind', 'backend_provider',
      'name', 'ZZ Schvaleni', 'description', '${opts.description ?? "puvodni"}',
      'capabilities', ${caps},
      'lifecycle', jsonb_build_object('load_strategy', 'hot')));
END $$;`);
}
const stav = () => psqlQuery(`SELECT status::text FROM public.plugin_catalog WHERE slug = '${SLUG}'`).trim();
const schvalit = () =>
  psqlMultiline(`${HEADER}UPDATE public.plugin_catalog SET status = 'ga' WHERE slug = '${SLUG}';`);

beforeAll(async () => {
  await reportTestCapabilities("schválení pluginu přežije nasazení");
});

describe("submit_plugin: schválení vs. opakované podání", () => {
  it.skipIf(!dbAvailable)("shodné podání (jako při každém nasazení) schválení DRŽÍ", () => {
    psqlMultiline(`${HEADER}DELETE FROM public.plugin_catalog WHERE slug = '${SLUG}';`);
    podani({ sha: "a".repeat(64), capabilities: ["http.GET./status"] });
    expect(stav()).toBe("submitted");
    schvalit();
    podani({ sha: "a".repeat(64), capabilities: ["http.GET./status"] });
    expect(stav(), "shodné podání shodilo schválený plugin — po každém deployi 404").toBe("ga");
  });

  it.skipIf(!dbAvailable)("změna jen popisu schválení DRŽÍ", () => {
    podani({ sha: "a".repeat(64), capabilities: ["http.GET./status"], description: "novy popis" });
    expect(stav()).toBe("ga");
  });

  it.skipIf(!dbAvailable)("⛔ nová capability schválení RUŠÍ", () => {
    podani({ sha: "a".repeat(64), capabilities: ["http.GET./status", "http.POST./smazat"] });
    expect(stav(), "rozšíření oprávnění prošlo bez schválení").toBe("submitted");
  });

  it.skipIf(!dbAvailable)("⛔ jiný kód pod toutéž verzí schválení RUŠÍ", () => {
    schvalit();
    podani({ sha: "b".repeat(64), capabilities: ["http.GET./status", "http.POST./smazat"] });
    expect(stav(), "vyměněný artefakt prošel bez schválení").toBe("submitted");
    psqlMultiline(`${HEADER}DELETE FROM public.plugin_catalog WHERE slug = '${SLUG}';`);
  });
});
