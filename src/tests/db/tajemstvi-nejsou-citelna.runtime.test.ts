/**
 * Klíče šifrování nepřečte žádná role kromě vlastníka — CHOVÁNÍ na skutečné DB.
 *
 * ⛔ NAMĚŘENO 2026-09-25 (dočasná DB z infra/postgres, produkční příkaz): klíč
 * sloupců, klíč trezoru i JWT secret byly GUC (`ALTER DATABASE … SET`) a přečetla
 * je KAŽDÁ role — 11 login rolí i anon/authenticated/service_role — přes
 * current_setting() i pg_db_role_setting; anon s klíčem dešifroval sloupec mimo
 * audit a service_role mohl zavolat aisha_column_encryption_key() i přes /rpc.
 *
 * Tady se měří vlastnost, ne tvar: pro KAŽDOU ne-superuživatelskou roli z
 * pg_roles (ne seznam) — pod SET ROLE, tedy tak, jak dotazy pouští PostgREST —
 *   - žádné nastavení (pg_settings, current_setting známých jmen) klíč nenese,
 *   - katalog pg_db_role_setting klíč nenese (pokrývá i ALTER ROLE … SET),
 *   - helpery klíčů a pohled vault.decrypted_secrets skončí 42501.
 *
 * ⛔ KONTROLNÍ VZOREK JE POVINNÝ: „klíč nikde" platí jen tehdy, když ho vlastník
 * sankcionovanou cestou skutečně dostane (jinak by test prošel i nad DB bez
 * klíčů), a když šifrování sloupců i trezor pod service_role dál FUNGUJÍ
 * (jinak by „bezpečné" znamenalo „rozbité").
 *
 * Spouští se přes: npm run test:db:tajemstvi (throwaway DB z baseline + heals + seed)
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const RUN = randomUUID().slice(0, 8);
/** Wrapper throwaway DB nastaví AISHA_DB_URL — pak je nedosažitelná DB vada, ne důvod přeskočit. */
const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);

type Vysledek = { ok: true; out: string } | { ok: false; err: string };

/**
 * psql jako superuživatel testovací DB; `pred` se pustí před dotazem (SET ROLE…).
 * Hodnoty klíčů jdou jen stdinem jako psql proměnné — nikdy v argv ani ve výstupu.
 */
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

const jakoRole = (role: string) => `SET request.jwt.claims = '{"role":"${role}"}';\nSET ROLE "${role}";`;

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("klíče šifrování nepřečte nikdo kromě vlastníka", () => {
  const klice: Record<string, string> = {};
  let role: string[] = [];

  beforeAll(() => {
    if (!isPgReachable()) {
      throw new Error("AISHA_DB_URL je nastavené (throwaway wrapper), ale DB není dosažitelná — vada harnessu, ne důvod přeskočit.");
    }
    // KONTROLNÍ VZOREK: vlastník (superuživatel = vlastník helperů) klíče dostane.
    klice.sloupce = hodnota(psql("SELECT public.aisha_column_encryption_key()"), "klíč sloupců pro vlastníka");
    klice.trezoru = hodnota(psql("SELECT public.aisha_vault_encryption_key()"), "klíč trezoru pro vlastníka");
    role = hodnota(
      psql("SELECT string_agg(rolname, ',' ORDER BY rolname) FROM pg_roles WHERE NOT rolsuper AND rolname !~ '^pg_'"),
      "seznam rolí",
    ).split(",");
  });

  it("kontrolní vzorek: vlastník klíče dostane a měřené role zahrnují PostgREST role", () => {
    expect(klice.sloupce.length, "klíč sloupců musí mít ≥ 32 znaků").toBeGreaterThanOrEqual(32);
    expect(klice.trezoru.length, "klíč trezoru nesmí být prázdný").toBeGreaterThan(0);
    for (const r of ["anon", "authenticated", "service_role", "authenticator"]) {
      expect(role, `role ${r} musí být mezi měřenými — jinak by „nikdo nečte" nic neznamenalo`).toContain(r);
    }
  });

  it("databáze nemá v katalogu žádné GUC s tajemstvím (ani starými jmény)", () => {
    const pocet = hodnota(
      psql(
        `SELECT count(*) FROM pg_db_role_setting
          WHERE strpos(array_to_string(setconfig, E'\\n'), :'ks') > 0
             OR strpos(array_to_string(setconfig, E'\\n'), :'kt') > 0
             OR array_to_string(setconfig, E'\\n') ~ '(column_encryption_key|vault_encryption_key|jwt_secret)='`,
        "",
        { ks: klice.sloupce, kt: klice.trezoru },
      ),
      "pg_db_role_setting",
    );
    expect(pocet, "pg_db_role_setting nese klíč — přečte ho každá role (sdílený katalog)").toBe("0");
  });

  it("žádná role nenajde klíč v nastavení relace", () => {
    const nalezy: string[] = [];
    for (const r of role) {
      const v = psql(
        `SELECT (SELECT count(*) FROM pg_settings WHERE strpos(setting, :'ks') > 0 OR strpos(setting, :'kt') > 0)
              + (CASE WHEN coalesce(current_setting('app.column_encryption_key', true), '') IN (:'ks', :'kt') THEN 1 ELSE 0 END)
              + (CASE WHEN coalesce(current_setting('app.settings.vault_encryption_key', true), '') IN (:'ks', :'kt') THEN 1 ELSE 0 END)`,
        jakoRole(r),
        { ks: klice.sloupce, kt: klice.trezoru },
      );
      if (!v.ok) nalezy.push(`${r}: měření selhalo — ${v.err.split("\n")[0]}`);
      else if (v.out !== "0") nalezy.push(`${r}: klíč v nastavení (${v.out}×)`);
    }
    expect(nalezy, nalezy.join("\n")).toEqual([]);
  });

  it("žádná role nezavolá helper klíče ani nepřečte vault.decrypted_secrets (42501)", () => {
    const nalezy: string[] = [];
    for (const r of role) {
      for (const dotaz of [
        "SELECT public.aisha_column_encryption_key()",
        "SELECT public.aisha_vault_encryption_key()",
        "SELECT count(*) FROM vault.decrypted_secrets",
      ]) {
        const v = psql(dotaz, jakoRole(r));
        if (v.ok) nalezy.push(`${r}: ${dotaz} PROŠLO`);
        else if (!/permission denied/i.test(v.err)) nalezy.push(`${r}: ${dotaz} selhalo jinak než 42501 — ${v.err.split("\n")[0]}`);
      }
    }
    expect(nalezy, nalezy.join("\n")).toEqual([]);
  });

  it("KONTROLNÍ VZOREK: šifrování sloupců funguje pod vlastníkem (klíč doručen) — role ho přímo nevolají", () => {
    // ⛔ Zpevnění (b) 2026-09-29: EXECUTE na aisha_{en,de}crypt_column_audited nemá žádná
    // role (dřív authenticated + service_role = obecné orákulum). Volají je jen DEFINER
    // funkce domova (set_data_source_secrets, get_plugin_runtime_config) — tu cestu
    // měří povereni-zpevneni.runtime.test.ts. Tady zůstává důkaz, že KLÍČ je doručen
    // a šifra funguje (vlastník, bez SET ROLE).
    const zprava = `probe-${RUN}`;
    const v = psql(
      `SELECT public.aisha_decrypt_column_audited(public.aisha_encrypt_column_audited(:'z')) = :'z'`,
      // vlastník (bez SET ROLE) s claims služby — strážce uvnitř funkce chce službu nebo správce
      `SET request.jwt.claims = '{"role":"service_role"}';`,
      { z: zprava },
    );
    expect(hodnota(v, "encrypt/decrypt pod vlastníkem")).toBe("t");
  });

  it("KONTROLNÍ VZOREK: trezor zapíše pod service_role, přečte definer cesta, cizí role nezapíše", () => {
    const jmeno = `tajemstvi-probe-${RUN}`;
    try {
      const id = hodnota(
        psql("SELECT vault.create_secret(:'h', :'j', 'test tajemstvi-nejsou-citelna')", jakoRole("service_role"), {
          h: `hodnota-${RUN}`,
          j: jmeno,
        }),
        "vault.create_secret pod service_role",
      );
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      // Vlastník (superuživatel) čte pohled stejně jako SECURITY DEFINER spotřebitelé.
      expect(
        hodnota(psql("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = :'j'", "", { j: jmeno }), "čtení trezoru"),
      ).toBe(`hodnota-${RUN}`);
      for (const r of ["anon", "authenticated"]) {
        const v = psql("SELECT vault.create_secret('x', :'j')", jakoRole(r), { j: `${jmeno}-${r}` });
        expect(v.ok, `${r} nesmí spustit vault.create_secret`).toBe(false);
      }
    } finally {
      psql("DELETE FROM vault.secrets WHERE name LIKE :'p'", "", { p: `${jmeno}%` });
    }
  });

  // ⛔ NAMĚŘENO 2026-09-28 (fork): vault.update_secret padal na míchání typů
  // (sloupec `text` × pgp_sym_encrypt `bytea`) — test výš měřil jen create a čtení.
  it("KONTROLNÍ VZOREK: trezor ZMĚNÍ tajemství pod service_role — nová hodnota, NULL zachová, jen jméno", () => {
    const jmeno = `tajemstvi-zmena-${RUN}`;
    const cti = (j: string) =>
      hodnota(psql("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = :'j'", "", { j }), "čtení trezoru");
    try {
      const id = hodnota(
        psql("SELECT vault.create_secret(:'h', :'j', 'test změny')", jakoRole("service_role"), { h: `puvodni-${RUN}`, j: jmeno }),
        "vault.create_secret pod service_role",
      );
      hodnota(
        psql("SELECT vault.update_secret(:'id'::uuid, :'h')", jakoRole("service_role"), { id, h: `nova-${RUN}` }),
        "vault.update_secret s novou hodnotou",
      );
      expect(cti(jmeno), "po změně se čte NOVÁ hodnota").toBe(`nova-${RUN}`);
      hodnota(
        psql("SELECT vault.update_secret(:'id'::uuid, NULL, :'j2')", jakoRole("service_role"), { id, j2: `${jmeno}-prejmenovano` }),
        "vault.update_secret jen jméno (tajemství NULL)",
      );
      expect(cti(`${jmeno}-prejmenovano`), "NULL tajemství hodnotu zachová").toBe(`nova-${RUN}`);
      for (const r of ["anon", "authenticated"]) {
        const v = psql("SELECT vault.update_secret(:'id'::uuid, 'x')", jakoRole(r), { id });
        expect(v.ok, `${r} nesmí spustit vault.update_secret`).toBe(false);
      }
    } finally {
      psql("DELETE FROM vault.secrets WHERE name LIKE :'p'", "", { p: `${jmeno}%` });
    }
  });
});
