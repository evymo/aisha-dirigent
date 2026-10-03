import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Schválení NAŠEHO pluginu do provozu jedním úkonem správce (2026-09-26).
 *
 * ⛔ NAMĚŘENO v produkci instance: zdroje aktivní, pověření vyplněná, pluginy
 * dvakrát člověkem posunuté do `ga` — a po nasazení s novým kódem znovu
 * `submitted`. Reset je správný (pod schváleným pluginem nesmí běžet jiný kód),
 * ale znovu schválit nebylo kde: `transition_plugin_status` nevolalo nic.
 *
 * Měří se nad skutečnou DB: nárok (jen správa), průchod automatem až do canary
 * s auditem KAŽDÉHO kroku a otiskem artefaktu, idempotence, odmítnutí cizí
 * důvěry a vypnutého pluginu, a celý cyklus „nový kód → submitted → znovu schválit".
 */
const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";
const SLUG = "zz-test-schvaleni";
const CIZI_SLUG = "zz-test-schvaleni-external";
const SPRAVCE = "78787878-7878-4878-8878-787878787878";
const BEZNY = "78787878-7878-4878-8878-7878787878bb";

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

/**
 * Pokus, který MÁ selhat. Bez ON_ERROR_STOP by chyba prošla jako úspěch — proto
 * STOP a chyba se čte ze stderr výjimky. Vrací text chyby, nebo 'PROSLO'.
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

const podat = (slug: string, sha: string) =>
  psqlMultiline(`${HEADER}DO $$ BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM public.submit_plugin(
    p_artifact_sha256 := '${sha}',
    p_artifact_url := 'http://minio:9000/aisha-plugins/${slug}/1.0.0.js',
    p_manifest := jsonb_build_object('id', '${slug}', 'version', '1.0.0', 'kind', 'data_source',
      'capabilities', jsonb_build_array('cron.sync_a'),
      -- Neřetězcový prvek (5) je vada manifestu — politika ho nesmí vydat jako povolení.
      'sandbox', jsonb_build_object('network_allowlist', jsonb_build_array('api.example.test', 5),
                                    'rpc_allowlist', jsonb_build_array('zz_zapis_audited')),
      'lifecycle', jsonb_build_object('load_strategy', 'hot')));
END $$;`);

const stav = (slug: string) => dotaz(`SELECT status FROM public.plugin_catalog WHERE slug = '${slug}';`);

beforeAll(async () => {
  await reportTestCapabilities("schválení pluginu");
  if (!dbAvailable) return;
  psqlMultiline(`${HEADER}
DELETE FROM public.plugin_catalog WHERE slug IN ('${SLUG}', '${CIZI_SLUG}');
INSERT INTO aisha_auth.users (id, email) VALUES
  ('${SPRAVCE}', 'schvaleni-spravce@test.local'), ('${BEZNY}', 'schvaleni-bezny@test.local')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, email) VALUES
  ('${SPRAVCE}', 'schvaleni-spravce@test.local'), ('${BEZNY}', 'schvaleni-bezny@test.local')
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${SPRAVCE}', 'admin') ON CONFLICT DO NOTHING;`);
  podat(SLUG, "a".repeat(64));
  podat(CIZI_SLUG, "b".repeat(64));
  psqlMultiline(`${HEADER}UPDATE public.plugin_catalog SET trust_tier = 'external' WHERE slug = '${CIZI_SLUG}';`);
});

const politika = (slug: string) =>
  JSON.parse(dotaz(`SELECT public.get_plugin_sandbox_policy('${slug}')::text;`)) as {
    schvaleno: boolean; source_slug: string | null; network_allowlist: string[]; rpc_allowlist: string[];
  };

describe("schválení našeho pluginu do provozu jedním úkonem správce", () => {
  it.skipIf(!dbAvailable)("strojové podání je internal a čeká na člověka (submitted)", () => {
    expect(stav(SLUG)).toBe("submitted");
    expect(dotaz(`SELECT trust_tier FROM public.plugin_catalog WHERE slug = '${SLUG}';`)).toBe("internal");
  });

  it.skipIf(!dbAvailable)("neschválený plugin nesmí z sandboxu nikam: politika vydá prázdné seznamy", () => {
    expect(politika(SLUG)).toEqual({ schvaleno: false, source_slug: null, network_allowlist: [], rpc_allowlist: [] });
  });

  it.skipIf(!dbAvailable)("sandbox politiku čte jen služba (broker), přihlášený uživatel ne", () => {
    const chyba = zkusJako(SPRAVCE, `SELECT public.get_plugin_sandbox_policy('${SLUG}')`);
    expect(chyba).not.toBe("PROSLO");
    expect(chyba).toMatch(/permission denied|jen služba/);
  });

  it.skipIf(!dbAvailable)("běžný uživatel neschválí nic — ani nezjistí, že plugin existuje", () => {
    const chyba = zkusJako(BEZNY, `SELECT public.approve_internal_plugin('${SLUG}')`);
    expect(chyba).not.toBe("PROSLO");
    expect(chyba).toMatch(/jen správa/);
    expect(stav(SLUG)).toBe("submitted");
  });

  it.skipIf(!dbAvailable)("správce schválí: automat se projde až do canary, audit nese každý krok i otisk artefaktu", () => {
    const vysledek = JSON.parse(jako(SPRAVCE, `public.approve_internal_plugin('${SLUG}')`));
    expect(vysledek).toMatchObject({ ok: true, status: "canary", zmena: true, version: "1.0.0" });
    expect(vysledek.kroky).toEqual(["reviewing", "sandbox_testing", "approved", "canary"]);
    expect(stav(SLUG)).toBe("canary");

    const audit = dotaz(`SELECT string_agg(e.metadata->>'to_status' || ':' || left(e.metadata->>'artifact_sha256', 4)
                                           || ':' || (e.actor_id = '${SPRAVCE}')::text, ',' ORDER BY e.created_at, e.id)
                           FROM public.plugin_audit_events e JOIN public.plugin_catalog pc ON pc.id = e.plugin_id
                          WHERE pc.slug = '${SLUG}' AND e.action = 'PLUGIN_STATUS_CHANGE'
                            AND e.metadata->>'via' = 'approve_internal_plugin';`);
    expect(audit.split(",").sort()).toEqual(
      ["approved:aaaa:true", "canary:aaaa:true", "reviewing:aaaa:true", "sandbox_testing:aaaa:true"],
    );
  });

  it.skipIf(!dbAvailable)("schválený plugin dostane hostitele a RPC ze své politiky (jen řetězce)", () => {
    expect(politika(SLUG)).toEqual({
      schvaleno: true, source_slug: null, network_allowlist: ["api.example.test"], rpc_allowlist: ["zz_zapis_audited"],
    });
  });

  it.skipIf(!dbAvailable)("druhé kliknutí nic nemění (idempotence)", () => {
    const vysledek = JSON.parse(jako(SPRAVCE, `public.approve_internal_plugin('${SLUG}')`));
    expect(vysledek).toMatchObject({ ok: true, status: "canary", zmena: false, kroky: [] });
  });

  it.skipIf(!dbAvailable)("nový kód při nasazení vrátí plugin na submitted a jde znovu schválit", () => {
    podat(SLUG, "c".repeat(64));
    expect(stav(SLUG), "jiný otisk artefaktu = jiný kód, schválení nesmí přežít").toBe("submitted");
    const vysledek = JSON.parse(jako(SPRAVCE, `public.approve_internal_plugin('${SLUG}')`));
    expect(vysledek).toMatchObject({ status: "canary", zmena: true });
    expect(vysledek.artifact_sha256).toBe("c".repeat(64));
  });

  it.skipIf(!dbAvailable)("shodný artefakt při dalším nasazení schválení NEZRUŠÍ", () => {
    podat(SLUG, "c".repeat(64));
    expect(stav(SLUG)).toBe("canary");
  });

  it.skipIf(!dbAvailable)("cizí důvěra (external) se jedním úkonem neschvaluje", () => {
    const chyba = zkusJako(SPRAVCE, `SELECT public.approve_internal_plugin('${CIZI_SLUG}')`);
    expect(chyba).toMatch(/jen internal/);
    expect(stav(CIZI_SLUG)).toBe("submitted");
  });

  it.skipIf(!dbAvailable)("vypnutý plugin se kliknutím nezapne — to patří do přezkoumání", () => {
    psqlMultiline(`${HEADER}UPDATE public.plugin_catalog SET status = 'disabled' WHERE slug = '${SLUG}';`);
    const chyba = zkusJako(SPRAVCE, `SELECT public.approve_internal_plugin('${SLUG}')`);
    expect(chyba).toMatch(/přezkoumáním/);
    expect(stav(SLUG)).toBe("disabled");
  });

  it.skipIf(!dbAvailable)("neznámý plugin = srozumitelná chyba, ne tichý úspěch", () => {
    const chyba = zkusJako(SPRAVCE, `SELECT public.approve_internal_plugin('zz-neexistuje')`);
    expect(chyba).toMatch(/není v katalogu/);
  });
});
