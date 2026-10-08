/**
 * verify-schema-public-live.sh — tři verdikty nad živou databází: v pořádku, díra, NEZMĚŘENO.
 *
 * Skript se SPOUŠTÍ (cíl `__local__`), `docker` je atrapa na PATH: vyjmenuje
 * kontejnery a místo psql vrátí připravený výstup a návratový kód. Měří se to,
 * na čem stojí doktor i ověření po nasazení — návratový kód a poslední řádek:
 *   0 = v pořádku, 1 = díra (s výčtem, kdo co smí), 2 = nezměřeno (není zelená).
 *
 * A měří se, CO skript databázi pošle: výchozí režim jen čtecí kontrolu
 * v transakci jen pro čtení (nad produkcí se nic nezkouší zapsat); zkoušku
 * chováním jen na výslovný přepínač.
 *
 * Spouští se přes: npx vitest run --config vitest.scripts.config.mjs scripts/db/verify-schema-public-live.test.mjs
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripSqlComments } from "./lib/sql-comments.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SKRIPT = path.join(ROOT, "scripts/db/verify-schema-public-live.sh");
const CTECI = path.join(ROOT, "scripts/db/verify-schema-public-acl.sql");
const CHOVANIM = path.join(ROOT, "scripts/db/verify-schema-public-create.sql");

/** Pustí skript s atrapou dockeru. `kontejnery` = výstup `docker ps`, `psql` = co vrátí `docker exec`. */
function pust({ kontejnery, psql = { out: "", rc: 0 }, cil = "__local__", prepinace = [] }) {
  const dir = mkdtempSync(path.join(tmpdir(), "zive-overeni-"));
  const vstup = path.join(dir, "vstup.sql");
  writeFileSync(path.join(dir, "kontejnery"), kontejnery);
  writeFileSync(path.join(dir, "psql.out"), psql.out);
  writeFileSync(
    path.join(dir, "docker"),
    `#!/usr/bin/env bash
case "$1" in
  ps) cat "${dir}/kontejnery" ;;
  exec) cat > "${vstup}"; printf '%s\\n' "$*" > "${dir}/exec.argv"; cat "${dir}/psql.out" >&2; exit ${psql.rc} ;;
  *) echo "atrapa dockeru: neznámý příkaz $1" >&2; exit 99 ;;
esac
`,
  );
  chmodSync(path.join(dir, "docker"), 0o755);
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
  let rc = 0;
  let out = "";
  try {
    out = execFileSync("bash", [SKRIPT, ...prepinace, cil], { env, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    rc = e.status;
    out = String(e.stdout ?? "");
  }
  const cti = (f) => {
    try {
      return readFileSync(path.join(dir, f), "utf-8");
    } catch {
      return null;
    }
  };
  return { rc, out: out.trim(), poslaneSql: cti("vstup.sql"), argv: cti("exec.argv") };
}

describe("živé ověření schématu public — tři verdikty", () => {
  it("v pořádku: kód 0, vypíše změřené řádky bez předpony psql", () => {
    const r = pust({
      kontejnery: "aplikace-web\ndb-abc123\ndb-druha\n",
      psql: {
        out: "psql:<stdin>:99: NOTICE:  schéma public (vlastník x) — CREATE v ACL: [nocodb_app, x]; právo vytvářet mají role: [nocodb_app]; bez práva: 11 rolí\npsql:<stdin>:99: NOTICE:  schéma public — vlastníci objektů: nocodb_app: 67 relací; x: 2208 funkcí\n",
        rc: 0,
      },
    });
    expect(r.rc).toBe(0);
    expect(r.out.split("\n")).toEqual([
      "schéma public (vlastník x) — CREATE v ACL: [nocodb_app, x]; právo vytvářet mají role: [nocodb_app]; bez práva: 11 rolí",
      "schéma public — vlastníci objektů: nocodb_app: 67 relací; x: 2208 funkcí",
    ]);
    expect(r.argv, "první kontejner db-*, ne libovolný").toContain("db-abc123");
    expect(r.argv).toContain("ON_ERROR_STOP=1");
  });

  it("výchozí režim JEN ČTE: pošle čtecí kontrolu a vynutí transakci jen pro čtení", () => {
    const r = pust({ kontejnery: "db-abc123\n" });
    expect(r.poslaneSql, "nad živou databází jde čtecí kontrola, ne zkouška chováním").toBe(readFileSync(CTECI, "utf-8"));
    expect(r.argv, "zápis musí skončit chybou, ne zápisem").toContain("default_transaction_read_only=on");
    // Rozhoduje se o KÓDU: bez komentářů a bez řetězců (jména práv a hlášky nesou slovo CREATE).
    const kod = stripSqlComments(readFileSync(CTECI, "utf-8")).replace(/'(?:[^']|'')*'/g, "''");
    expect(kod, "čtecí kontrola nesmí nic zakládat ani přebírat roli").not.toMatch(
      /\b(CREATE|DROP|ALTER|INSERT|UPDATE|DELETE|GRANT|REVOKE|TRUNCATE)\b|\bSET\s+(LOCAL\s+)?ROLE\b/i,
    );
  });

  it("zkouška chováním jen na výslovný přepínač — a pak bez vynucení čtení", () => {
    const r = pust({ kontejnery: "db-abc123\n", prepinace: ["--zkouska-chovanim"] });
    expect(r.rc).toBe(0);
    expect(r.poslaneSql).toBe(readFileSync(CHOVANIM, "utf-8"));
    expect(r.argv).not.toContain("default_transaction_read_only");
  });

  it("díra: kód 1 a výčet odchylek bez předpony psql", () => {
    const r = pust({
      kontejnery: "db-abc123\n",
      psql: {
        out: "psql:<stdin>:106: NOTICE:  schéma public (vlastník x) — CREATE v ACL: [PUBLIC]; …\npsql:<stdin>:106: ERROR:  schéma public — kdo smí vytvářet: PUBLIC má ve schématu public právo CREATE; role anon ve schématu public vytvořila tabulku\nCONTEXT:  PL/pgSQL function inline_code_block line 84 at RAISE\n",
        rc: 3,
      },
    });
    expect(r.rc).toBe(1);
    expect(r.out).toBe(
      "schéma public — kdo smí vytvářet: PUBLIC má ve schématu public právo CREATE; role anon ve schématu public vytvořila tabulku",
    );
  });

  it("kontrola spadla z jiného důvodu: kód 2 (nezměřeno), ne díra ani zelená", () => {
    const r = pust({ kontejnery: "db-abc123\n", psql: { out: 'psql: error: connection to server failed: FATAL: role "postgres" does not exist\n', rc: 2 } });
    expect(r.rc).toBe(2);
    expect(r.out).toMatch(/^NEZMĚŘENO: kontrola nedoběhla \(rc=2\)/);
  });

  it("na cíli není kontejner databáze: kód 2 a kontrola se nepustí", () => {
    const r = pust({ kontejnery: "aplikace-web\nredis-1\n" });
    expect(r.rc).toBe(2);
    expect(r.out).toMatch(/^NEZMĚŘENO: na cíli/);
    expect(r.poslaneSql, "bez databáze se nesmí nic posílat").toBeNull();
  });

  it("bez cíle: kód 2", () => {
    const r = pust({ kontejnery: "db-abc123\n", cil: "" });
    expect(r.rc).toBe(2);
  });
});
