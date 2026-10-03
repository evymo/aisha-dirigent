/**
 * Spustí skutečný infra/postgres/entrypoint-wrapper.sh s podvrženým postgresem
 * (pg_isready = hned připraven, psql zapíše předaný `-f` soubor) a vrátí SQL,
 * které by re-applier poslal databázi. Sdílí ho brána (tvar a podmínky) i DB test
 * (vykonání proti skutečnému Postgresu).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function sqlZWrapperu(root: string, prostredi: Record<string, string>): { sql: string; vystup: string } {
  const dir = mkdtempSync(join(tmpdir(), "aisha-pg-reapply-"));
  const bin = join(dir, "bin");
  const pgdata = join(dir, "pgdata");
  const zachyceno = join(dir, "reapply.sql");
  try {
    mkdirSync(bin, { recursive: true });
    mkdirSync(pgdata, { recursive: true });
    writeFileSync(join(pgdata, "PG_VERSION"), "17\n");
    const stub = (jmeno: string, telo: string) => writeFileSync(join(bin, jmeno), `#!/bin/sh\n${telo}\n`, { mode: 0o755 });
    stub("docker-entrypoint.sh", 'echo "ENTRYPOINT-START"; exit 0');
    stub("pg_isready", "exit 0");
    stub("sleep", "exit 0");
    stub("chown", "exit 0");
    // `-f SOUBOR` → zachytit; TCP ověření hesla (`-tAc 'SELECT 1'`) → „1"; ostatní dotazy nic.
    stub(
      "psql",
      [
        'prev=""',
        'for a in "$@"; do',
        `  if [ "$prev" = "-f" ]; then cp "$a" "${zachyceno}"; fi`,
        '  if [ "$a" = "SELECT 1" ]; then echo 1; fi',
        '  prev="$a"',
        "done",
        "exit 0",
      ].join("\n"),
    );
    const beh = spawnSync("bash", [join(root, "infra/postgres/entrypoint-wrapper.sh"), "postgres"], {
      env: {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        PG_MAJOR: "17",
        PGDATA: pgdata,
        POSTGRES_PASSWORD: "zkusebni-heslo-db",
        VAULT_ENCRYPTION_KEY: "zkusebni-klic-trezoru",
        COLUMN_ENCRYPTION_KEY: "zkusebni-klic-sloupcu",
        // Klíče zapisuje wrapper do /run/aisha-keys — mimo kontejner do dočasného adresáře.
        AISHA_KLICE_DIR: join(dir, "klice"),
        ...prostredi,
      },
      encoding: "utf8",
      timeout: 30_000,
    });
    // Re-applier běží na pozadí; počká se, až soubor zachytí (nejvýš ~10 s).
    const konec = Date.now() + 10_000;
    while (!existsSync(zachyceno) && Date.now() < konec) spawnSync("sh", ["-c", "sleep 0.1"]);
    const sql = existsSync(zachyceno) ? readFileSync(zachyceno, "utf8") : "";
    return { sql, vystup: `${beh.stdout ?? ""}\n${beh.stderr ?? ""}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Řádky re-apply SQL, které se týkají role postgres_exporter. */
export const exporterRadky = (sql: string): string[] => sql.split("\n").filter((r) => r.includes("postgres_exporter"));
