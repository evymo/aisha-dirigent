/**
 * Pověření poskytovatelů AI v administraci — každý fork svoje (RUNTIME, throwaway DB).
 *
 * Měří se CHOVÁNÍ na skutečné DB (baseline + heals + seed), pod SET ROLE a s claims
 * tak, jak dotazy pouští PostgREST:
 *
 *   hodnotu NEPŘEČTE anon, authenticated ani admin (žádná cesta ji nevrací);
 *   služba (service_role) ji přečte JEN pro jména z katalogu (odvozeného z registrů);
 *   jméno mimo katalog a systémová tajemství (service_role_key, GITHUB_APP_PRIVATE_KEY)
 *     se přes tyto funkce nezapíšou ani nepřečtou — ani když plugin jméno do katalogu
 *     deklaruje (vlastní jmenný prostor `credential:`);
 *   audit nese jména, NIKDY hodnoty;
 *   set_provider_credential_if_absent nepřepíše hodnotu z administrace;
 *   obecné čtečky trezoru prostor `credential:` nevydají (ani pod službou, ani adminovi);
 *   dosavadní `openai_api_key` heals přejmenuje do nového domova (hodnota DB neopustí);
 *     stará cesta (set_api_key_admin, migrate_app_secrets_to_vault — beze změny) nový
 *     domov nepřepíše. Měří se v transakci s ROLLBACK: jména `openai_api_key` používá
 *     i souběžný app-secrets-trezor test (npm run test:db pouští soubory paralelně).
 *
 * KONTROLNÍ VZOREK: admin pověření ZAPÍŠE a služba ho DOSTANE — jinak by „nikdo nečte"
 * prošlo i nad rozbitou DB. Hodnoty jsou zjevné sentinely (SENTINEL-…) a do psql jdou
 * jen stdinem jako proměnné, nikdy v argv.
 *
 * Spouští se přes: npm run test:db:povereni-poskytovatelu
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

/** Wrapper throwaway DB nastaví AISHA_DB_URL — pak je nedosažitelná DB vada, ne důvod přeskočit. */
const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);
const RUN = randomUUID().slice(0, 8);
const ADMIN = randomUUID();
const UZIVATEL = randomUUID();
const H = {
  anthropic: `SENTINEL-anthropic-${RUN}`,
  anthropic2: `SENTINEL-anthropic-nova-${RUN}`,
  openaiEnv: `SENTINEL-openai-env-${RUN}`,
  openaiJiny: `SENTINEL-openai-jiny-${RUN}`,
  github: `SENTINEL-github-pem-${RUN}`,
  legacy: `SENTINEL-legacy-openai-${RUN}`,
  plugin: `SENTINEL-plugin-${RUN}`,
};
const PLUGIN_SLUG = `test-plugin-provider-${RUN}`;

type Vysledek = { ok: true; out: string } | { ok: false; err: string };

function psql(sql: string, pred = "", promenne: Record<string, string> = {}): Vysledek {
  const nastav = Object.entries(promenne)
    .map(([k, v]) => `\\set ${k} '${v.replace(/'/g, "''")}'`)
    .join("\n");
  try {
    const out = execFileSync(
      "psql",
      ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA", "-q"],
      {
        input: `${nastav}\n\\o /dev/null\n${pred}\n\\o\n${sql};`,
        encoding: "utf-8",
        env: { ...process.env, PGPASSWORD: PG_PASSWORD },
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).trim();
    return { ok: true, out };
  } catch (e) {
    return { ok: false, err: String((e as { stderr?: string }).stderr ?? e) };
  }
}

function hodnota(v: Vysledek, co: string): string {
  if (!v.ok) throw new Error(`${co}: ${v.err}`);
  return v.out;
}

const jako = (role: string, sub?: string) =>
  `SET request.jwt.claims = '${JSON.stringify(sub ? { sub, role } : { role })}';\nSET ROLE "${role}";`;
const SLUZBA = jako("service_role");
const ADMIN_PRED = jako("authenticated", ADMIN);
const UZIVATEL_PRED = jako("authenticated", UZIVATEL);
const ANON = jako("anon");

/** Dešifrovaná hodnota pod vlastníkem (superuživatel) — jen pro ověření, co v trezoru leží. */
const vTrezoru = (jmeno: string) =>
  hodnota(psql("SELECT coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = :'j'), '<nic>')", "", { j: jmeno }), `trezor ${jmeno}`);

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("pověření poskytovatelů: každý fork svoje, hodnotu čte jen služba", () => {
  beforeAll(() => {
    if (!isPgReachable()) {
      throw new Error("AISHA_DB_URL je nastavené (throwaway wrapper), ale DB není dosažitelná — vada harnessu, ne důvod přeskočit.");
    }
    hodnota(
      psql(
        `INSERT INTO aisha_auth.users (id, email) VALUES (:'a', :'ae'), (:'u', :'ue') ON CONFLICT DO NOTHING;
         INSERT INTO public.user_roles (user_id, role) VALUES (:'a', 'admin') ON CONFLICT DO NOTHING`,
        "",
        { a: ADMIN, ae: `admin-${RUN}@example.invalid`, u: UZIVATEL, ue: `uzivatel-${RUN}@example.invalid` },
      ),
      "příprava osob",
    );
    // Systémové tajemství BEZ prefixu (jako ho zakládá scripts/vault-seed.sh).
    hodnota(
      psql("DELETE FROM vault.secrets WHERE name IN ('GITHUB_APP_PRIVATE_KEY', 'credential:ANTHROPIC_API_KEY', 'credential:OPENAI_API_KEY'); SELECT vault.create_secret(:'h', 'GITHUB_APP_PRIVATE_KEY', 'test')", "", { h: H.github }),
      "systémové tajemství",
    );
  });

  it("KONTROLNÍ VZOREK: katalog je odvozený z registrů — poskytovatelé i runtime (cli:claude-cli, cli:codex-cli)", () => {
    const radky = hodnota(
      psql("SELECT env_var || '|' || used_by::text FROM public.get_provider_credential_catalog() ORDER BY env_var", SLUZBA),
      "katalog pod službou",
    ).split("\n");
    const jmena = radky.map((r) => r.split("|")[0]);
    for (const j of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_AI_API_KEY", "AGENT_CLAUDE_OAUTH_TOKEN"]) {
      expect(jmena, `katalog musí obsahovat ${j}`).toContain(j);
    }
    expect(jmena).not.toContain("GITHUB_APP_PRIVATE_KEY");
    // Pověření, která generuje platforma (poskytovatel backend_kind='llm_gateway'), správa nenastavuje.
    expect(jmena).not.toContain("AISHA_LLM_GATEWAY_KEY");
    expect(jmena).not.toContain("LLM_GW_API_KEY");
    expect(radky.find((r) => r.startsWith("AGENT_CLAUDE_OAUTH_TOKEN|"))).toContain('"slug": "cli:claude-cli"');
    expect(radky.find((r) => r.startsWith("OPENAI_API_KEY|"))).toContain('"slug": "cli:codex-cli"');
  });

  it("KONTROLNÍ VZOREK: admin pověření nastaví a služba ho dostane", () => {
    const r = psql("SELECT public.set_provider_credential_admin('ANTHROPIC_API_KEY', :'h')->>'operation'", ADMIN_PRED, { h: H.anthropic });
    expect(hodnota(r, "admin nastaví")).toBe("created");
    expect(vTrezoru("credential:ANTHROPIC_API_KEY")).toBe(H.anthropic);
    const s = psql("SELECT coalesce(value, '<null>') FROM public.get_provider_credentials(ARRAY['ANTHROPIC_API_KEY'])", SLUZBA);
    expect(hodnota(s, "služba čte")).toBe(H.anthropic);
    // Nahrazení
    const r2 = psql("SELECT public.set_provider_credential_admin('ANTHROPIC_API_KEY', :'h')->>'operation'", ADMIN_PRED, { h: H.anthropic2 });
    expect(hodnota(r2, "admin nahradí")).toBe("replaced");
    expect(vTrezoru("credential:ANTHROPIC_API_KEY")).toBe(H.anthropic2);
  });

  it("admin vidí stav (nastaveno, kdy, kým, odkud) — ale ŽÁDNOU hodnotu ani její část", () => {
    const out = hodnota(
      psql("SELECT row_to_json(c)::text FROM public.get_provider_credential_catalog() c WHERE env_var = 'ANTHROPIC_API_KEY'", ADMIN_PRED),
      "stav pod adminem",
    );
    const radek = JSON.parse(out) as Record<string, unknown>;
    expect(radek.is_set).toBe(true);
    expect(radek.updated_by).toBe(ADMIN);
    expect(radek.source).toBe("admin");
    const vse = hodnota(psql("SELECT json_agg(c)::text FROM public.get_provider_credential_catalog() c", ADMIN_PRED), "celý katalog");
    // Ani celá hodnota, ani její začátek (všechny sentinely začínají „SENTINEL").
    for (const h of Object.values(H)) expect(vse).not.toContain(h);
    expect(vse).not.toContain("SENTINEL");
    expect(vse).not.toMatch(/masked|••/);
  });

  it("anon, přihlášený bez role admin i admin hodnotu NEPŘEČTOU žádnou cestou", () => {
    const nalezy: string[] = [];
    for (const [kdo, pred] of [["anon", ANON], ["authenticated", UZIVATEL_PRED], ["admin", ADMIN_PRED]] as const) {
      for (const dotaz of [
        "SELECT value FROM public.get_provider_credentials(ARRAY['ANTHROPIC_API_KEY'])",
        "SELECT count(*) FROM vault.secrets",
        "SELECT count(*) FROM vault.decrypted_secrets",
        "SELECT public.get_app_secret('credential:ANTHROPIC_API_KEY')",
        "SELECT public.provider_credential_catalog()",
        "SELECT public.set_provider_credential_if_absent('OPENAI_API_KEY', 'SENTINEL-x')",
      ]) {
        const v = psql(dotaz, pred);
        if (v.ok) nalezy.push(`${kdo}: ${dotaz} PROŠLO (${v.out.includes("SENTINEL") ? "S HODNOTOU" : "bez hodnoty"})`);
      }
    }
    expect(nalezy, nalezy.join("\n")).toEqual([]);
  });

  it("katalog a zápis: anon ani přihlášený bez role admin nesmí; admin ano", () => {
    for (const [kdo, pred] of [["anon", ANON], ["authenticated", UZIVATEL_PRED]] as const) {
      expect(psql("SELECT count(*) FROM public.get_provider_credential_catalog()", pred).ok, `${kdo} katalog`).toBe(false);
      expect(psql("SELECT public.set_provider_credential_admin('ANTHROPIC_API_KEY', 'SENTINEL-cizi')", pred).ok, `${kdo} zápis`).toBe(false);
      expect(psql("SELECT public.delete_provider_credential_admin('ANTHROPIC_API_KEY')", pred).ok, `${kdo} smazání`).toBe(false);
    }
    expect(vTrezoru("credential:ANTHROPIC_API_KEY")).toBe(H.anthropic2);
  });

  it("jméno mimo katalog a systémová tajemství se zapsat ani přečíst nedají", () => {
    for (const jmeno of ["NOT_IN_CATALOG_TEST", "service_role_key", "GITHUB_APP_PRIVATE_KEY", "credential:ANTHROPIC_API_KEY"]) {
      const a = psql("SELECT public.set_provider_credential_admin(:'j', 'SENTINEL-mimo')", ADMIN_PRED, { j: jmeno });
      expect(a.ok, `admin zapsal ${jmeno}`).toBe(false);
      const s = psql("SELECT public.set_provider_credential_if_absent(:'j', 'SENTINEL-mimo')", SLUZBA, { j: jmeno });
      expect(s.ok, `služba zapsala ${jmeno}`).toBe(false);
    }
    const cteni = hodnota(
      psql(
        "SELECT count(*) || '|' || coalesce(string_agg(coalesce(value,'<null>'), ','), '') FROM public.get_provider_credentials(ARRAY['NOT_IN_CATALOG_TEST','service_role_key','GITHUB_APP_PRIVATE_KEY','edge_functions_url'])",
        SLUZBA,
      ),
      "čtení mimo katalog",
    );
    expect(cteni).toBe("0|");
    expect(vTrezoru("GITHUB_APP_PRIVATE_KEY")).toBe(H.github);
    expect(hodnota(psql("SELECT count(*) FROM vault.secrets WHERE name LIKE 'credential:%' AND name NOT IN ('credential:ANTHROPIC_API_KEY')"), "nic navíc")).toBe("0");
  });

  it("plugin, který si do katalogu DEKLARUJE jméno systémového tajemství, dostane jen svůj jmenný prostor", () => {
    try {
      hodnota(
        psql(
          "INSERT INTO public.ai_provider_registry (slug, display_name, backend_kind, auth_env_var, is_enabled) VALUES (:'s', 'test', 'direct_cloud', 'GITHUB_APP_PRIVATE_KEY', false)",
          "",
          { s: PLUGIN_SLUG },
        ),
        "plugin provider",
      );
      // Čtení: jméno je v katalogu, ale míří do credential:GITHUB_APP_PRIVATE_KEY (prázdné) — ne do systémového.
      const cteni = hodnota(
        psql("SELECT env_var || '=' || coalesce(value, '<null>') FROM public.get_provider_credentials(ARRAY['GITHUB_APP_PRIVATE_KEY'])", SLUZBA),
        "čtení deklarovaného jména",
      );
      expect(cteni).toBe("GITHUB_APP_PRIVATE_KEY=<null>");
      // Zápis: jde do vlastního prostoru, systémové tajemství zůstane.
      hodnota(psql("SELECT public.set_provider_credential_admin('GITHUB_APP_PRIVATE_KEY', :'h')", ADMIN_PRED, { h: H.plugin }), "zápis deklarovaného jména");
      expect(vTrezoru("GITHUB_APP_PRIVATE_KEY")).toBe(H.github);
      expect(vTrezoru("credential:GITHUB_APP_PRIVATE_KEY")).toBe(H.plugin);
    } finally {
      psql("DELETE FROM public.ai_provider_registry WHERE slug = :'s'; DELETE FROM vault.secrets WHERE name = 'credential:GITHUB_APP_PRIVATE_KEY'", "", { s: PLUGIN_SLUG });
    }
  });

  it("platformní pověření (backend_kind llm_gateway) v katalogu nejsou — odvozeno z vlastnosti, ne ze jména", () => {
    const brana = `test-brana-${RUN}`;
    const primy = `test-primy-${RUN}`;
    try {
      hodnota(
        psql(
          `INSERT INTO public.ai_provider_registry (slug, display_name, backend_kind, auth_env_var, is_enabled) VALUES
             (:'b', 'test brána', 'llm_gateway', 'TEST_PLATFORM_GW_KEY', false),
             (:'p', 'test přímý', 'direct_cloud', 'TEST_DIRECT_PROVIDER_KEY', false)`,
          "",
          { b: brana, p: primy },
        ),
        "testovací poskytovatelé",
      );
      const jmena = hodnota(psql("SELECT string_agg(env_var, ',') FROM public.get_provider_credential_catalog()", SLUZBA), "katalog").split(",");
      expect(jmena).toContain("TEST_DIRECT_PROVIDER_KEY");
      expect(jmena).not.toContain("TEST_PLATFORM_GW_KEY");
      for (const jmeno of ["TEST_PLATFORM_GW_KEY", "AISHA_LLM_GATEWAY_KEY", "LLM_GW_API_KEY"]) {
        expect(psql("SELECT public.set_provider_credential_admin(:'j', 'SENTINEL-brana')", ADMIN_PRED, { j: jmeno }).ok, `admin zapsal ${jmeno}`).toBe(false);
        expect(psql("SELECT public.set_provider_credential_if_absent(:'j', 'SENTINEL-brana')", SLUZBA, { j: jmeno }).ok, `služba zapsala ${jmeno}`).toBe(false);
      }
    } finally {
      psql("DELETE FROM public.ai_provider_registry WHERE slug IN (:'b', :'p')", "", { b: brana, p: primy });
    }
  });

  it("přesun z prostředí: zapíše jen chybějící, hodnotu z administrace NEPŘEPÍŠE, podruhé nic", () => {
    expect(hodnota(psql("SELECT public.set_provider_credential_if_absent('OPENAI_API_KEY', :'h')", SLUZBA, { h: H.openaiEnv }), "první přesun")).toBe("t");
    expect(hodnota(psql("SELECT public.set_provider_credential_if_absent('OPENAI_API_KEY', :'h')", SLUZBA, { h: H.openaiJiny }), "druhý přesun")).toBe("f");
    expect(vTrezoru("credential:OPENAI_API_KEY")).toBe(H.openaiEnv);
    expect(hodnota(psql("SELECT public.set_provider_credential_if_absent('ANTHROPIC_API_KEY', :'h')", SLUZBA, { h: H.anthropic }), "přes administraci")).toBe("f");
    expect(vTrezoru("credential:ANTHROPIC_API_KEY")).toBe(H.anthropic2);
    const zdroj = hodnota(psql("SELECT source FROM public.get_provider_credential_catalog() WHERE env_var = 'OPENAI_API_KEY'", SLUZBA), "zdroj");
    expect(zdroj).toBe("env");
  });

  it("prázdná hodnota a mezera na kraji jsou chyba (admin i přesun)", () => {
    for (const h of ["", "   ", " SENTINEL-mezera"]) {
      expect(psql("SELECT public.set_provider_credential_admin('GOOGLE_AI_API_KEY', :'h')", ADMIN_PRED, { h }).ok, JSON.stringify(h)).toBe(false);
      expect(psql("SELECT public.set_provider_credential_if_absent('GOOGLE_AI_API_KEY', :'h')", SLUZBA, { h }).ok, JSON.stringify(h)).toBe(false);
    }
    // Konec řádku na kraji (typická vada vložení) — literál v SQL, psql proměnná by ho rozbila.
    expect(psql("SELECT public.set_provider_credential_admin('GOOGLE_AI_API_KEY', E'SENTINEL-konec\\n')", ADMIN_PRED).ok).toBe(false);
    expect(psql("SELECT public.set_provider_credential_if_absent('GOOGLE_AI_API_KEY', E'SENTINEL-konec\\n')", SLUZBA).ok).toBe(false);
    expect(vTrezoru("credential:GOOGLE_AI_API_KEY")).toBe("<nic>");
  });

  it("obecné čtečky trezoru prostor credential: nevydají — pod službou ani adminovi (negativní sonda)", () => {
    // KONTROLNÍ VZOREK: pověření v trezoru JE (jinak by „nevydají" nic neměřilo).
    expect(vTrezoru("credential:OPENAI_API_KEY")).toBe(H.openaiEnv);
    expect(hodnota(psql("SELECT coalesce(public.get_app_secret('credential:OPENAI_API_KEY'), '<null>')", SLUZBA), "get_app_secret")).toBe("<null>");
    expect(hodnota(psql("SELECT count(*) FROM public.get_app_secrets_batch(ARRAY['credential:OPENAI_API_KEY'])", SLUZBA), "batch")).toBe("0");
    expect(
      hodnota(psql(`SELECT public.edge_app_secrets('get_many', '{"keys":["credential:OPENAI_API_KEY"]}'::jsonb)->'rows'`, SLUZBA), "edge get_many"),
    ).toBe("[]");
    for (const dotaz of [
      "SELECT public.get_app_secret('credential:OPENAI_API_KEY')",
      "SELECT value FROM public.get_app_secrets_batch(ARRAY['credential:OPENAI_API_KEY'])",
      `SELECT public.edge_app_secrets('get_many', '{"keys":["credential:OPENAI_API_KEY"]}'::jsonb)`,
    ]) {
      const v = psql(dotaz, ADMIN_PRED);
      expect(v.ok && v.out.includes("SENTINEL"), `admin: ${dotaz} vydal hodnotu`).toBe(false);
    }
  });

  it("ani ZÁPIS přes edge_app_secrets upsert_admin katalog neobejde — credential:X odmítnuto, stav beze změny", () => {
    const stav = () =>
      hodnota(psql("SELECT row_to_json(c)::text FROM public.get_provider_credential_catalog() c WHERE env_var = 'OPENAI_API_KEY'", SLUZBA), "stav");
    const pred = stav();
    for (const klic of ["credential:OPENAI_API_KEY", "credential:NOT_IN_CATALOG_TEST"]) {
      const r = psql(
        "SELECT public.edge_app_secrets('upsert_admin', jsonb_build_object('actor_user_id', :'a', 'key', :'k', 'value', 'SENTINEL-obchvat'))",
        SLUZBA,
        { a: ADMIN, k: klic },
      );
      expect(r.ok, `upsert_admin zapsal ${klic}`).toBe(false);
    }
    expect(stav(), "katalog se změnil").toBe(pred);
    expect(vTrezoru("credential:OPENAI_API_KEY")).toBe(H.openaiEnv);
    expect(vTrezoru("credential:NOT_IN_CATALOG_TEST")).toBe("<nic>");
    // KONTROLNÍ VZOREK: běžné jméno mimo prostor upsert_admin dál zapíše (stará cesta funguje).
    const bezny = psql(
      "SELECT public.edge_app_secrets('upsert_admin', jsonb_build_object('actor_user_id', :'a', 'key', :'k', 'value', 'test-bezny'))",
      SLUZBA,
      { a: ADMIN, k: `test_edge_${RUN}` },
    );
    expect(bezny.ok, bezny.ok ? "" : bezny.err).toBe(true);
    psql("DELETE FROM vault.secrets WHERE name = :'k'", "", { k: `test_edge_${RUN}` });
  });

  it("audit nese jména a role, NIKDY hodnoty", () => {
    const akce = hodnota(
      psql(
        `SELECT string_agg(DISTINCT action, ',' ORDER BY action) FROM public.audit_journal
          WHERE action IN ('ADMIN_SET_PROVIDER_CREDENTIAL','SERVICE_READ_PROVIDER_CREDENTIALS','PROVIDER_CREDENTIAL_MOVED_FROM_ENV')`,
      ),
      "akce auditu",
    );
    expect(akce).toBe("ADMIN_SET_PROVIDER_CREDENTIAL,PROVIDER_CREDENTIAL_MOVED_FROM_ENV,SERVICE_READ_PROVIDER_CREDENTIALS");
    const cteni = hodnota(
      psql(
        `SELECT metadata::text FROM public.audit_journal WHERE action = 'SERVICE_READ_PROVIDER_CREDENTIALS'
          AND metadata->'requested' ? 'ANTHROPIC_API_KEY' ORDER BY created_at LIMIT 1`,
      ),
      "audit čtení",
    );
    expect(cteni).toContain('"role": "service_role"');
    const unik = hodnota(
      psql(
        "SELECT count(*) FROM public.audit_journal a WHERE " +
          Object.keys(H)
            .map((k) => `strpos(row_to_json(a)::text, :'${k}') > 0`)
            .join(" OR "),
        "",
        H,
      ),
      "hodnoty v auditu",
    );
    expect(unik, "hodnota pověření v audit_journal").toBe("0");
    const sentinel = hodnota(psql("SELECT count(*) FROM public.audit_journal a WHERE strpos(row_to_json(a)::text, 'SENTINEL') > 0"), "sentinel v auditu");
    expect(sentinel, "jakákoli testovací hodnota v audit_journal").toBe("0");
  });

  it("smazání: admin smaže, služba pak dostane NULL; systémové tajemství smazat nejde", () => {
    expect(hodnota(psql("SELECT public.delete_provider_credential_admin('ANTHROPIC_API_KEY')->>'deleted'", ADMIN_PRED), "smazání")).toBe("true");
    expect(
      hodnota(psql("SELECT coalesce(value, '<null>') FROM public.get_provider_credentials(ARRAY['ANTHROPIC_API_KEY'])", SLUZBA), "po smazání"),
    ).toBe("<null>");
    expect(hodnota(psql("SELECT public.delete_provider_credential_admin('GITHUB_APP_PRIVATE_KEY')->>'deleted'", ADMIN_PRED), "systémové")).toBe("false");
    expect(vTrezoru("GITHUB_APP_PRIVATE_KEY")).toBe(H.github);
  });

  it("dosavadní openai_api_key: heals ho přejmenuje do nového domova; stará cesta nový domov nepřepíše", () => {
    // Vše v jedné transakci s ROLLBACK — viz hlavička (souběžný app-secrets test).
    const v = psql(
      `BEGIN;
       SET LOCAL test.legacy = :'h';
       DO $$
       DECLARE r text; hodnota text;
       BEGIN
         DELETE FROM vault.secrets WHERE name IN ('openai_api_key', 'credential:OPENAI_API_KEY');
         -- 1) bez starého klíče: nic
         r := public.migrate_legacy_openai_key_to_credential();
         IF r <> 'nic' THEN RAISE EXCEPTION 'bez starého klíče: %', r; END IF;
         -- 2) se starým klíčem: přejmenuje, hodnota tatáž, starý řádek pryč
         PERFORM vault.create_secret(current_setting('test.legacy'), 'openai_api_key', '{"updated_by": null}');
         r := public.migrate_legacy_openai_key_to_credential();
         IF r <> 'presunuto' THEN RAISE EXCEPTION 'se starým klíčem: %', r; END IF;
         SELECT decrypted_secret INTO hodnota FROM vault.decrypted_secrets WHERE name = 'credential:OPENAI_API_KEY';
         IF hodnota IS DISTINCT FROM current_setting('test.legacy') THEN RAISE EXCEPTION 'nový domov nemá hodnotu starého klíče'; END IF;
         IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'openai_api_key') THEN RAISE EXCEPTION 'starý řádek zůstal'; END IF;
         -- 3) idempotence
         r := public.migrate_legacy_openai_key_to_credential();
         IF r <> 'nic' THEN RAISE EXCEPTION 'podruhé: %', r; END IF;
         -- 4) stará cesta (beze změny) založí starý řádek z nešifrované kopie — nový domov platí dál
         INSERT INTO public.app_secrets (key, value) VALUES ('openai_api_key', 'SENTINEL-kopie')
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
         PERFORM public.migrate_app_secrets_to_vault();
         r := public.migrate_legacy_openai_key_to_credential();
         IF r <> 'oba_existuji' THEN RAISE EXCEPTION 'oba: %', r; END IF;
         SELECT decrypted_secret INTO hodnota FROM vault.decrypted_secrets WHERE name = 'credential:OPENAI_API_KEY';
         IF hodnota IS DISTINCT FROM current_setting('test.legacy') THEN RAISE EXCEPTION 'stará cesta přepsala nový domov'; END IF;
       END $$;
       SELECT 'ok';
       ROLLBACK`,
      "",
      { h: H.legacy },
    );
    expect(v.ok ? v.out : v.err.split("\n").find((l) => /ERROR/.test(l))).toBe("ok");
    expect(v.ok ? v.out : v.err, "hodnota v hlášce").not.toContain("SENTINEL");
  });
});
