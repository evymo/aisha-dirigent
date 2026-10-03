import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Plánovač pluginů: host zapíše deklarace, plánovač je atomicky zabírá.
 *
 * ⛔ NAMĚŘENO 2026-09-16: `plugin_schedules` nikdo neplnil ani nečetl, takže cron
 * capability pluginů nikdy neběžely; `register_plugin_schedule` byl SECURITY
 * DEFINER pro každého přihlášeného bez kontroly nároku.
 *
 * Měří se chování nad skutečnou DB: validace deklarací proti manifestu, vypnutí
 * nedeklarovaného, zabrání jen splatného rozvrhu schváleného pluginu, pronájem
 * (druhé zabrání téhož nevrátí) a nárok (běžný uživatel nic z toho nesmí).
 */
const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";
const SLUG = "zz-test-planovac";
const TENANT = "33333333-3333-4333-8333-333333333333";
const SLUZBA = "PERFORM set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);";

const sluzbou = (sql: string) => psqlMultiline(`${HEADER}DO $$\nBEGIN\n  ${SLUZBA}\n  ${sql}\nEND $$;`);
const dotaz = (sql: string) =>
  psqlQuery(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) IS NOT NULL AND true; ${sql}`)
    .trim()
    .split("\n")
    .pop() ?? "";

beforeAll(async () => {
  await reportTestCapabilities("plánovač pluginů");
});

describe("plánovač pluginů: reconcile → claim → příští termín", () => {
  it.skipIf(!dbAvailable)("reconcile zapíše platné deklarace, neplatné odmítne a nedeklarované vypne", () => {
    psqlMultiline(`${HEADER}DELETE FROM public.plugin_catalog WHERE slug = '${SLUG}';`);
    sluzbou(`PERFORM public.submit_plugin(
      p_artifact_sha256 := repeat('c', 64),
      p_artifact_url := 'http://minio:9000/aisha-plugins/${SLUG}/1.0.0.js',
      p_manifest := jsonb_build_object('id', '${SLUG}', 'version', '1.0.0', 'kind', 'data_source',
        'capabilities', jsonb_build_array('cron.sync_a', 'cron.sync_b', 'http.GET./status'),
        'lifecycle', jsonb_build_object('load_strategy', 'hot')));`);

    const prvni = dotaz(`SELECT public.reconcile_plugin_schedules('${SLUG}', '${TENANT}', jsonb_build_array(
      jsonb_build_object('cron', '*/5 * * * *', 'capability', 'cron.sync_a', 'next_run_at', (now() - interval '1 minute')::text),
      jsonb_build_object('cron', '0 3 * * *', 'capability', 'cron.sync_b', 'next_run_at', (now() + interval '1 hour')::text),
      jsonb_build_object('cron', '0 3 * * *', 'capability', 'http.GET./status'),
      jsonb_build_object('cron', '0 3 * *', 'capability', 'cron.sync_a'),
      jsonb_build_object('cron', '0 3 * * *')))::text;`);
    const r = JSON.parse(prvni) as { zapsano: number; vypnuto: number; odmitnuto: unknown[] };
    expect(r.zapsano).toBe(2);
    expect(r.odmitnuto.length, "http capability, špatný cron a starý tvar se musí odmítnout").toBe(3);

    const druhy = JSON.parse(
      dotaz(`SELECT public.reconcile_plugin_schedules('${SLUG}', '${TENANT}', jsonb_build_array(
        jsonb_build_object('cron', '*/5 * * * *', 'capability', 'cron.sync_a')))::text;`),
    ) as { vypnuto: number };
    expect(druhy.vypnuto, "rozvrh, který plugin už nedeklaruje, se musí vypnout").toBe(1);
  });

  it.skipIf(!dbAvailable)("⛔ neschválený plugin (submitted) plánovač NEZABERE", () => {
    const n = dotaz(`SELECT count(*) FROM public.claim_due_plugin_schedules(50, 60) WHERE plugin_slug = '${SLUG}';`);
    expect(Number(n)).toBe(0);
  });

  it.skipIf(!dbAvailable)("schválený plugin: splatný rozvrh se zabere JEDNOU (pronájem), nesplatný vůbec", () => {
    psqlMultiline(`${HEADER}UPDATE public.plugin_catalog SET status = 'ga' WHERE slug = '${SLUG}';`);
    const zabrane = dotaz(
      `SELECT string_agg(handler_capability, ',') FROM public.claim_due_plugin_schedules(50, 60) WHERE plugin_slug = '${SLUG}';`,
    );
    expect(zabrane).toBe("cron.sync_a");
    const znovu = dotaz(`SELECT count(*) FROM public.claim_due_plugin_schedules(50, 60) WHERE plugin_slug = '${SLUG}';`);
    expect(Number(znovu), "pronájem nedržel — týž rozvrh by běžel dvakrát").toBe(0);

    const id = dotaz(
      `SELECT s.id FROM public.plugin_schedules s JOIN public.plugin_catalog p ON p.id = s.plugin_id WHERE p.slug = '${SLUG}' AND s.handler_capability = 'cron.sync_a';`,
    );
    expect(dotaz(`SELECT public.set_plugin_schedule_next_run('${id}', now() - interval '1 second');`)).toBe("t");
    const poTerminu = dotaz(`SELECT count(*) FROM public.claim_due_plugin_schedules(50, 60) WHERE plugin_slug = '${SLUG}';`);
    expect(Number(poTerminu), "po zapsání termínu v minulosti se rozvrh musí zabrat znovu").toBe(1);
  });

  it.skipIf(!dbAvailable)("⛔ běžný přihlášený uživatel nesmí zapisovat ani zabírat rozvrhy", () => {
    // `psqlQuery` při chybě DB VYHODÍ — `psqlMultiline` by vrátil jen stdout a
    // odmítnutí (stderr) by nebylo vidět, tvrzení by prošlo vždy.
    const jakoUzivatel = (volani: string) =>
      psqlQuery(
        `SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${TENANT}"}', true); ${volani}`,
      );
    const pluginId = psqlQuery(`SELECT id FROM public.plugin_catalog WHERE slug = '${SLUG}'`).trim();
    for (const volani of [
      `SELECT public.reconcile_plugin_schedules('${SLUG}', '${TENANT}', '[]'::jsonb);`,
      `SELECT * FROM public.claim_due_plugin_schedules(1, 60);`,
      `SELECT public.set_plugin_schedule_next_run('${TENANT}', now());`,
      `SELECT public.register_plugin_schedule('0 3 * * *', true, 'cron.sync_a', '${pluginId}', '${TENANT}');`,
    ]) {
      expect(() => jakoUzivatel(volani), `volání prošlo bez nároku: ${volani}`).toThrow(/jen služba/);
    }
    psqlMultiline(`${HEADER}DELETE FROM public.plugin_catalog WHERE slug = '${SLUG}';`);
  });
});
