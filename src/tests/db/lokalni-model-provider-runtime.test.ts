/**
 * Lokální model pod naší střechou — DB část, na ŽIVÉ čisté databázi.
 *
 * ⛔ NAMĚŘENO 2026-09-13 (čtením SoT + seedů):
 *   1. provider `vllm-local` seed zakládá vypnutý s aliasem `http://vllm:8000` a nic ho
 *      nezapínalo ani nepřesměrovalo na odvozenou adresu svc-model;
 *   2. `mark_models_unavailable` nevolal nikdo → seedované vLLM modely „dostupné",
 *      ačkoli je nic neobsluhovalo;
 *   3. `upsert_discovered_model` nenesl rozměr embeddingu, takže resolver prostoru
 *      (1024 → v1, 2560 → v2) stál na deklaraci, ne na měření.
 *
 * Proč runtime, ne statická brána: všechny tři vady jsou o tom, CO databáze po
 * provedení udělá (stav řádků, audit, výběr modelu pro prostor). Reconcile se testuje
 * TÝMŽ souborem, který pouští migrate entrypoint (scripts/deploy/reconcile-local-model-provider.sql).
 *
 * Kontrolní vzorky: u každého „nic se nestalo" tvrzení je vedle i opačný případ,
 * kde se stát MÁ — jinak by test prošel i nad slepou sondou.
 *
 * Běh: node scripts/db/with-throwaway-db.mjs -- npx vitest run src/tests/db/lokalni-model-provider-runtime.test.ts
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const ROOT = join(__dirname, "..", "..", "..");
const RECONCILE = join(ROOT, "scripts/deploy/reconcile-local-model-provider.sql");
const RUN = randomUUID().slice(0, 8);
const ENDPOINT = `http://testfork-model.experimental.testfork.internal:8000/v1`;

type Psql = { code: number; out: string; err: string };

function psqlRaw(args: string[], input?: string): Psql {
  const r = spawnSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA", ...args],
    { input, encoding: "utf-8", env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  );
  return { code: r.status ?? -1, out: (r.stdout ?? "").trim(), err: r.stderr ?? "" };
}

/**
 * SQL jako service_role, výsledek poslední SELECT. Claims pro funkce, které čtou
 * `is_service_role()`, a `SET ROLE` pro ty, které se ptají na `current_setting('role')`
 * (fn_resolve_embedding_model_for_space) — obě cesty jsou v SoT, test musí projít oběma.
 */
function svc(sql: string, role = false): string {
  const setRole = role ? "SET ROLE service_role;\n" : "";
  const r = psqlRaw([], `\\o /dev/null\nSET request.jwt.claims = '{"role":"service_role"}';\n${setRole}\\o\n${sql};`);
  if (r.code !== 0) throw new Error(r.err);
  return r.out;
}

function svcExpectError(sql: string): string {
  const r = psqlRaw([], `SET request.jwt.claims = '{"role":"service_role"}';\n${sql};`);
  expect(r.code, `mělo selhat: ${sql}`).not.toBe(0);
  return r.err;
}

const reconcile = (ep: string): Psql => psqlRaw(["-v", `ep=${ep}`, "-f", RECONCILE]);

const provider = () =>
  JSON.parse(
    svc(`SELECT row_to_json(p)::text FROM (SELECT is_enabled, endpoint_url, health_url, last_health_status
           FROM public.ai_provider_registry WHERE slug = 'vllm-local') p`),
  ) as { is_enabled: boolean; endpoint_url: string; health_url: string | null; last_health_status: string };

const auditCount = (action: string) =>
  Number(svc(`SELECT count(*) FROM public.audit_journal WHERE action = '${action}'`));

describe.skipIf(!isPgReachable())("lokální model — provider vllm-local, dostupnost a rozměr", () => {
  it("⛔ reconcile: bez odvozené adresy je provider VYPNUTÝ a řekne to nahlas", () => {
    // Kontrolní vzorek: nejdřív ho zapnout, aby „vypnutí" bylo měřitelné.
    svc(`UPDATE public.ai_provider_registry SET is_enabled = true WHERE slug = 'vllm-local'`);
    const before = auditCount("local_model_provider_reconciled");

    const r = reconcile("");
    expect(r.code, r.err).toBe(0);
    expect(r.err).toMatch(/vllm-local VYPNUTÝ/);
    expect(provider().is_enabled).toBe(false);
    expect(auditCount("local_model_provider_reconciled")).toBe(before + 1);
  });

  it("reconcile: odvozená adresa provider povolí, nastaví endpoint i health_url a modely zneplatní do discovery", () => {
    svc(`UPDATE public.ai_model_registry SET is_available = true WHERE provider = 'vllm'`);
    const dostupneVllm = () => Number(svc(`SELECT count(*) FROM public.ai_model_registry WHERE provider = 'vllm' AND is_available`));
    expect(dostupneVllm(), "fixture: seed musí mít vLLM modely").toBeGreaterThan(0);

    const r = reconcile(ENDPOINT);
    expect(r.code, r.err).toBe(0);
    const p = provider();
    expect(p).toMatchObject({ is_enabled: true, endpoint_url: ENDPOINT, health_url: `${ENDPOINT}/models`, last_health_status: "unknown" });
    expect(dostupneVllm(), "nová adresa = jiný server; dostupnost určí až discovery").toBe(0);
  });

  it("reconcile je idempotentní: táž adresa podruhé nic nezapíše", () => {
    const before = auditCount("local_model_provider_reconciled");
    const r = reconcile(ENDPOINT);
    expect(r.code, r.err).toBe(0);
    expect(r.err).toMatch(/beze změny/);
    expect(auditCount("local_model_provider_reconciled")).toBe(before);
  });

  it("⛔ reconcile: nesmyslná adresa je chyba, ne zápis", () => {
    const r = reconcile("vllm:8000");
    expect(r.code).not.toBe(0);
    expect(provider().endpoint_url).toBe(ENDPOINT);
  });

  it("upsert_discovered_model: změřený rozměr se zapíše, nezměřený nic nepřepíše, nesmysl je chyba", () => {
    const model = `lens-embedding-${RUN}`;
    const prvni = JSON.parse(svc(`SELECT public.upsert_discovered_model(p_provider => 'vllm', p_model_id => '${model}',
      p_is_chat_capable => false, p_is_embedding => true, p_embedding_dimensions => 1024)::text`));
    expect(prvni).toMatchObject({ is_new: true, embedding_dimensions: 1024 });

    const druhy = JSON.parse(svc(`SELECT public.upsert_discovered_model(p_provider => 'vllm', p_model_id => '${model}',
      p_is_chat_capable => false, p_is_embedding => true)::text`));
    expect(druhy, "sonda, která neodpověděla, rozměr nemaže").toMatchObject({ is_new: false, embedding_dimensions: 1024 });

    const err = svcExpectError(`SELECT public.upsert_discovered_model(p_provider => 'vllm', p_model_id => '${model}',
      p_is_embedding => true, p_embedding_dimensions => 0)`);
    expect(err).toMatch(/must be positive/);
  });

  it("⛔ mark_models_unavailable: co v úplném listingu není, je nedostupné — a znovu objevené se vrátí", () => {
    const ziva = `lens-embedding-${RUN}`;
    const mrtvy = `mrtvy-model-${RUN}`;
    svc(`SELECT public.upsert_discovered_model(p_provider => 'vllm', p_model_id => '${mrtvy}')`);
    const before = auditCount("models_marked_unavailable");

    const n = Number(svc(`SELECT public.mark_models_unavailable('vllm', ARRAY['${ziva}'])`));
    expect(n).toBeGreaterThanOrEqual(1);
    const stav = (m: string) => svc(`SELECT is_available FROM public.ai_model_registry WHERE provider = 'vllm' AND model_id = '${m}'`);
    expect(stav(mrtvy)).toBe("f");
    expect(stav(ziva), "kontrolní vzorek: model z listingu zůstává").toBe("t");
    expect(auditCount("models_marked_unavailable")).toBe(before + 1);

    const zpet = JSON.parse(svc(`SELECT public.upsert_discovered_model(p_provider => 'vllm', p_model_id => '${mrtvy}')::text`));
    expect(zpet).toMatchObject({ was_unavailable: true });
    expect(stav(mrtvy)).toBe("t");

    expect(svcExpectError(`SELECT public.mark_models_unavailable('vllm', NULL)`)).toMatch(/required/);
  });

  it("⛔ resolver prostoru: s 1024 i 2560 modelem dostupnými dostane každá dráha model SVÉHO rozměru", () => {
    const v1 = `lens-embedding-${RUN}`;
    const v2 = `wide-embedding-${RUN}`;
    svc(`SELECT public.upsert_discovered_model(p_provider => 'vllm', p_model_id => '${v2}',
      p_is_chat_capable => false, p_is_embedding => true, p_embedding_dimensions => 2560)`);
    // Discovery by modely, které nejsou v listingu, zneplatnila — tady tentýž stav výslovně.
    svc(`UPDATE public.ai_model_registry SET is_available = (model_id IN ('${v1}', '${v2}'))
          WHERE is_embedding AND provider_registry_id = (SELECT id FROM public.ai_provider_registry WHERE slug = 'vllm-local')`);
    svc(`UPDATE public.ai_provider_registry SET last_health_status = 'healthy' WHERE slug = 'vllm-local'`);

    const pro = (space: string) =>
      svc(`SELECT model_id || '|' || embedding_dimensions || '|' || provider_slug
             FROM public.fn_resolve_embedding_model_for_space('${space}', NULL)`, true);
    // Kontrolní vzorek i tvrzení v jednom: OBĚ dráhy musí něco dostat, každá jiný rozměr.
    const [m1, d1] = pro("v1").split("|");
    const [m2, d2] = pro("v2").split("|");
    expect(d1, `v1 dostal ${m1}`).toBe("1024");
    expect(d2, `v2 dostal ${m2}`).toBe("2560");
    expect(pro("v1")).toMatch(/\|vllm-local$/);
  });
});
