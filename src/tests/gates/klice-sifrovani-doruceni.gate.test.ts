/**
 * Klíče šifrování — kontrakt DORUČENÍ (výrobce ↔ spotřebitel)
 *
 * Klíč sloupců (aisha_{encrypt,decrypt}_column_audited) a klíč trezoru
 * (vault.secrets) čtou SQL helpery aisha_column_encryption_key() a
 * aisha_vault_encryption_key() ze SOUBORU /run/aisha-keys/<jméno>.key, který
 * při každém startu služby db zapíše infra/postgres/entrypoint-wrapper.sh
 * z env (COLUMN_ENCRYPTION_KEY / VAULT_ENCRYPTION_KEY).
 *
 * ⛔ Dřív byl kontraktem GUC (`ALTER DATABASE … SET app.column_encryption_key`
 * + PGOPTIONS) a tahle brána (tehdy column-encryption-key-guc) ho vynucovala.
 * NAMĚŘENO 2026-09-25 na dočasné DB: vlastní GUC přečte KAŽDÁ role (11 login
 * rolí, anon, authenticated, service_role) přes current_setting() i
 * pg_db_role_setting; anon s klíčem dešifroval sloupec mimo audit. Brána proto
 * teď hlídá opak: klíč teče souborem a do GUC se nevrátí. Třídu „tajemství
 * jako GUC" hlídá tajemstvi-neni-guc, skutečnou čitelnost test:db:tajemstvi.
 *
 * Proč parita výrobce/spotřebitel: když se rozejde (helper čte jinou cestu,
 * než kam entrypoint píše), nic nespadne při startu — první šifrování PHI/PII
 * nebo první čtení trezoru skončí výjimkou až v provozu.
 *
 * Spouští se přes: npm run test:gates
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function precti(rel: string): string {
  const p = join(ROOT, rel);
  expect(existsSync(p), `${rel} chybí — kontrakt doručení klíčů nemá kde stát`).toBe(true);
  return readFileSync(p, "utf8");
}

/** SQL bez řádkových komentářů — tvrzení se týkají kódu, ne vysvětlivek. */
function sqlBezKomentaru(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

const KLICE = [
  {
    env: "COLUMN_ENCRYPTION_KEY",
    soubor: "column_encryption.key",
    helper: "aisha/db/sql/functions/aisha_column_encryption_key.sql",
    funkce: "public.aisha_column_encryption_key()",
    spotrebitele: [
      "aisha/db/sql/functions/aisha_encrypt_column_audited.sql",
      "aisha/db/sql/functions/aisha_decrypt_column_audited.sql",
    ],
  },
  {
    env: "VAULT_ENCRYPTION_KEY",
    soubor: "vault_encryption.key",
    helper: "aisha/db/sql/functions/aisha_vault_encryption_key.sql",
    funkce: "public.aisha_vault_encryption_key()",
    spotrebitele: [
      "aisha/db/sql/views/vault_decrypted_secrets.sql",
      "aisha/db/sql/functions/vault_create_secret.sql",
      "aisha/db/sql/functions/vault_update_secret.sql",
    ],
  },
] as const;

const KLICE_DIR = "/run/aisha-keys";

describe("klíče šifrování: doručení souborem, ne GUC", () => {
  for (const k of KLICE) {
    describe(k.env, () => {
      it("helper čte PRÁVĚ ten soubor, který entrypoint zapisuje, a GUC nečte", () => {
        const helper = sqlBezKomentaru(precti(k.helper));
        expect(
          helper.includes(`pg_read_file('${KLICE_DIR}/${k.soubor}')`),
          `${k.helper} musí číst ${KLICE_DIR}/${k.soubor} přes pg_read_file — cesta je kontrakt s entrypoint-wrapper.sh`,
        ).toBe(true);
        expect(
          /current_setting\s*\(/i.test(helper),
          `${k.helper} nesmí číst klíč z GUC (current_setting) — GUC přečte každá role; žádná záloha na GUC`,
        ).toBe(false);
      });

      it("helper nikomu nedává EXECUTE (volá ho jen vlastník = definer spotřebitelé)", () => {
        const helper = sqlBezKomentaru(precti(k.helper));
        expect(/SECURITY\s+DEFINER/i.test(helper), `${k.helper} musí být SECURITY DEFINER (čte soubor jako vlastník)`).toBe(true);
        expect(/REVOKE\s+ALL\s+ON\s+FUNCTION[^;]*FROM\s+PUBLIC/i.test(helper), `${k.helper} musí mít REVOKE ALL … FROM PUBLIC`).toBe(true);
        expect(
          /GRANT\s+EXECUTE\s+ON\s+FUNCTION/i.test(helper),
          `${k.helper} nesmí GRANTovat EXECUTE — grant pro service_role dával klíč i přes PostgREST /rpc`,
        ).toBe(false);
      });

      it("spotřebitelé berou klíč z helperu", () => {
        for (const s of k.spotrebitele) {
          const sql = sqlBezKomentaru(precti(s));
          expect(sql.includes(k.funkce), `${s} musí brát klíč z ${k.funkce}`).toBe(true);
        }
      });

      it("entrypoint-wrapper.sh zapíše soubor z env PŘED větvením čistá/existující data", () => {
        const w = precti("infra/postgres/entrypoint-wrapper.sh");
        const zapis = w.indexOf(`zapis_klic ${k.soubor}`);
        const vetveni = w.indexOf('if [ ! -s "$PGDATA/PG_VERSION" ]; then');
        expect(zapis, `entrypoint-wrapper.sh musí zapsat ${k.soubor} (zapis_klic)`).toBeGreaterThan(-1);
        expect(vetveni, "entrypoint-wrapper.sh: větvení čistá/existující data nenalezeno").toBeGreaterThan(-1);
        expect(
          zapis < vetveni,
          `${k.soubor} se musí zapsat PŘED větvením — čistý initdb (exec docker-entrypoint.sh) by jinak startoval bez klíče`,
        ).toBe(true);
        expect(w.includes(`\${${k.env}:?`), `entrypoint-wrapper.sh musí ${k.env} vyžadovat (\${${k.env}:?…}) — prázdný klíč = start odmítnut`).toBe(true);
      });

      it("compose doručí env službě db a pipeline tajemství ho vede jako kritické", () => {
        const compose = precti("docker-compose.coolify.yml");
        expect(compose.includes(`${k.env}: \${${k.env}}`), `docker-compose.coolify.yml: služba db musí dostat ${k.env}`).toBe(true);
        expect(precti("scripts/generate-secrets.mjs").includes(k.env), `generate-secrets.mjs musí ${k.env} generovat`).toBe(true);
        expect(
          precti("scripts/aisha-env-doctor.mjs").includes(`"${k.env}"`),
          `aisha-env-doctor.mjs musí ${k.env} vést mezi kritickými klíči`,
        ).toBe(true);
      });
    });
  }

  it("existující DB: entrypoint staré GUC s tajemstvím RESETuje (katalog je jinak drží dál)", () => {
    const w = precti("infra/postgres/entrypoint-wrapper.sh");
    for (const guc of ["app.column_encryption_key", "app.settings.vault_encryption_key", "app.settings.jwt_secret"]) {
      expect(w.includes(`ALTER DATABASE postgres RESET ${guc};`), `entrypoint-wrapper.sh musí na existující DB RESETovat ${guc}`).toBe(true);
    }
  });

  it("adresář klíčů ve wrapperu = cesta, kterou čtou SQL helpery (přepis jen pro brány mimo kontejner)", () => {
    const w = precti("infra/postgres/entrypoint-wrapper.sh");
    expect(
      w.includes(`\nKLICE_DIR=${KLICE_DIR}\n`),
      `entrypoint-wrapper.sh musí zapisovat do ${KLICE_DIR} — tam čtou helpery pg_read_file`,
    ).toBe(true);
  });

  it("klíče leží v tmpfs služby db (nikdy na disk ani do zálohy)", () => {
    const compose = precti("docker-compose.coolify.yml");
    expect(compose.includes(`- ${KLICE_DIR}:mode=0700`), `služba db musí mít tmpfs ${KLICE_DIR}`).toBe(true);
  });
});
