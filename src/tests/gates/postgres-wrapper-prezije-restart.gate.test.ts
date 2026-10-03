/**
 * Wrapper Postgresu přežije RESTART téhož kontejneru, když minulý start nedoběhl.
 *
 * ⛔ NAMĚŘENO 2026-09-17 na instanci (giah, core db): hostiteli došlo místo,
 * postmaster padl na „could not write lock file postmaster.pid: No space left on
 * device". Wrapper už ale zapsal `/tmp/postgres-reapply.sql` (chown postgres,
 * chmod 600) a re-applier ho neuklidil — maže ho až po úspěchu. Docker kontejner
 * RESTARTOVAL (ne znovu vytvořil), `/tmp` zůstal, a každý další start skončil na
 * `cat > /tmp/postgres-reapply.sql: Permission denied`: hostitel má
 * `fs.protected_regular=2`, takže ani root nesmí O_CREAT na cizí soubor ve
 * sticky `/tmp`. `set -e` → exit → restart → totéž. 24 restartů, místo se mezitím
 * uvolnilo, a db se sama NIKDY nezvedla; pomohlo až nové vytvoření kontejneru.
 *
 * ⭐ Brána SPOUŠTÍ skutečný wrapper (bash) s podvrženým docker-entrypoint.sh,
 * pg_isready, psql a sleep nad existujícím datovým adresářem a s ZASTARALÝM
 * nezapisovatelným `/tmp/postgres-reapply.sql` — přesně stav po nedoběhlém startu.
 * Měří, že wrapper dojde až k předání postmasteru. (Nezapisovatelnost se tu
 * vyrábí módem 000; pod rootem ji mód nevyrobí, proto se mutace ověřuje mimo root.)
 */
import { afterAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const WRAPPER = join(ROOT, "infra/postgres/entrypoint-wrapper.sh");
const ZASTARALY = "/tmp/postgres-reapply.sql";

const dir = mkdtempSync(join(tmpdir(), "aisha-pg-wrapper-"));
const pgdata = join(dir, "pgdata");
const bin = join(dir, "bin");
// Mód souboru re-apply zaznamená podvržený psql ve chvíli, kdy ho dostane (`-f`).
// Dřív se po testu procházelo a MAZALO „nové" /tmp/postgres-reapply* — a s nimi
// soubor souběžně běžící brány postgres-exporter-heslo-pri-startu (naměřeno
// 2026-09-17). Teď re-applier doběhne a soubor po sobě smaže sám.
const zaznamModu = join(dir, "rezim-souboru.txt");
let zalozilJsem = false;

function stub(jmeno: string, telo: string) {
  writeFileSync(join(bin, jmeno), `#!/bin/sh\n${telo}\n`, { mode: 0o755 });
}

afterAll(() => {
  if (zalozilJsem && existsSync(ZASTARALY)) {
    chmodSync(ZASTARALY, 0o600);
    rmSync(ZASTARALY, { force: true });
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("Postgres wrapper přežije restart po nedoběhlém startu (brána)", () => {
  test("⛔ zastaralý nezapisovatelný /tmp/postgres-reapply.sql nezastaví start", () => {
    spawnSync("mkdir", ["-p", pgdata, bin]);
    writeFileSync(join(pgdata, "PG_VERSION"), "17\n");
    stub("docker-entrypoint.sh", 'echo "ENTRYPOINT-START $*"; exit 0');
    stub("pg_isready", "exit 0");
    stub(
      "psql",
      [
        'prev=""',
        'for a in "$@"; do',
        `  if [ "$prev" = "-f" ]; then ls -l "$a" | cut -c1-10 >> "${zaznamModu}"; fi`,
        '  if [ "$a" = "SELECT 1" ]; then echo 1; fi',
        '  prev="$a"',
        "done",
        "exit 0",
      ].join("\n"),
    );
    stub("sleep", "exit 0");
    stub("chown", "exit 0");

    if (!existsSync(ZASTARALY)) {
      writeFileSync(ZASTARALY, "-- zbytek po nedoběhlém startu\n");
      zalozilJsem = true;
    }
    if (zalozilJsem) chmodSync(ZASTARALY, 0o000);
    expect(existsSync(ZASTARALY), "fixtura zastaralého souboru nevznikla").toBe(true);
    // Fixtura musí být pro tenhle proces NEZAPISOVATELNÁ, jinak neměří nic.
    const zapisovatelny = spawnSync("sh", ["-c", `: > "${ZASTARALY}"`]).status === 0;
    const jsemRoot = typeof process.getuid === "function" && process.getuid() === 0;
    expect(zapisovatelny && !jsemRoot, "zastaralý soubor je zapisovatelný — fixtura nevyrobila stav z incidentu").toBe(false);

    const beh = spawnSync("bash", [WRAPPER, "postgres"], {
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        PG_MAJOR: "17",
        PGDATA: pgdata,
        POSTGRES_PASSWORD: "zkusebni-heslo-brany",
        VAULT_ENCRYPTION_KEY: "zkusebni-klic-trezoru-brany",
        COLUMN_ENCRYPTION_KEY: "zkusebni-klic-sloupcu-brany",
        // Klíče zapisuje wrapper do /run/aisha-keys — mimo kontejner do dočasného adresáře.
        AISHA_KLICE_DIR: join(dir, "klice"),
      },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(beh.stdout + beh.stderr, "wrapper nepředal start postmasteru").toContain("ENTRYPOINT-START postgres");
    expect(beh.status).toBe(0);
  });

  test("soubor pro re-apply nese jen vlastník (600), ať ho nečte nikdo jiný", () => {
    const konec = Date.now() + 10_000;
    while (!existsSync(zaznamModu) && Date.now() < konec) spawnSync("sh", ["-c", "sleep 0.1"]);
    expect(existsSync(zaznamModu), "re-applier soubor psql nepředal — měřilo by se prázdno").toBe(true);
    expect(readFileSync(zaznamModu, "utf8").trim().split("\n")[0]).toBe("-rw-------");
  });

  // ⛔ Klíče šifrování nejsou GUC (naměřeno 2026-09-25: GUC přečetla každá role). Wrapper je
  // zapisuje do souborů, které čtou SQL helpery. Měří se CHOVÁNÍ skutečného wrapperu na čistém
  // initdb (exec rovnou do entrypointu): obsah, práva, a že postmaster klíče v prostředí nemá.
  test("klíče šifrování: soubory 0400 v adresáři 0700, obsah = env bez uvozovek, postmaster je v env nemá", () => {
    const klice = join(dir, "klice-cisty");
    const pgdataCisty = join(dir, "pgdata-cisty");
    spawnSync("mkdir", ["-p", pgdataCisty, bin]);
    stub(
      "docker-entrypoint.sh",
      `echo "ENTRYPOINT-START"; echo "KLICE-V-ENV:$(env | grep -c -E '^(VAULT_ENCRYPTION_KEY|COLUMN_ENCRYPTION_KEY|JWT_SECRET|PGOPTIONS)=')"; exit 0`,
    );
    stub("chown", "exit 0");
    const spust = (prostredi: Record<string, string>) =>
      spawnSync("bash", [WRAPPER, "postgres"], {
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          PG_MAJOR: "17",
          PGDATA: pgdataCisty,
          POSTGRES_PASSWORD: "zkusebni-heslo-brany",
          JWT_SECRET: "jwt-databaze-nepotrebuje",
          PGOPTIONS: "-c app.cokoli=x",
          AISHA_KLICE_DIR: klice,
          ...prostredi,
        },
        encoding: "utf8",
        timeout: 30_000,
      });

    // Atrapy klíčů se skládají za běhu: skener tajemství (gitleaks generic-api-key) se chytá
    // na tvar `*_KEY: "literál"` a výjimku v .gitleaks.toml repo nepřidává pro hodnoty z testů.
    const atrapa = (...casti: string[]) => ["atrapa", ...casti].join("-");

    // Coolify ukládá hodnoty v uvozovkách — do souboru jde hodnota BEZ nich (bajtově jako dřív GUC).
    const beh = spust({ VAULT_ENCRYPTION_KEY: `'${atrapa("trezor", "v-uvozovkach")}'`, COLUMN_ENCRYPTION_KEY: `"${atrapa("sloupce", "v-uvozovkach")}"` });
    const vystup = `${beh.stdout}${beh.stderr}`;
    expect(vystup, "wrapper nepředal start postmasteru").toContain("ENTRYPOINT-START");
    expect(vystup, "postmaster dostal klíč / JWT secret / PGOPTIONS v prostředí").toContain("KLICE-V-ENV:0");
    expect(readFileSync(join(klice, "vault_encryption.key"), "utf8")).toBe(atrapa("trezor", "v-uvozovkach"));
    expect(readFileSync(join(klice, "column_encryption.key"), "utf8")).toBe(atrapa("sloupce", "v-uvozovkach"));
    expect(statSync(join(klice, "vault_encryption.key")).mode & 0o777).toBe(0o400);
    expect(statSync(join(klice, "column_encryption.key")).mode & 0o777).toBe(0o400);
    expect(statSync(klice).mode & 0o777).toBe(0o700);

    // Druhý start (restart kontejneru) přepíše 0400 soubor bez chyby.
    expect(spust({ VAULT_ENCRYPTION_KEY: atrapa("trezor", "2"), COLUMN_ENCRYPTION_KEY: atrapa("sloupce", "2") }).status).toBe(0);
    expect(readFileSync(join(klice, "column_encryption.key"), "utf8")).toBe(atrapa("sloupce", "2"));

    // Prázdný klíč (i jen uvozovky) = start odmítnut, žádný prázdný soubor.
    const prazdny = spust({ VAULT_ENCRYPTION_KEY: atrapa("trezor", "3"), COLUMN_ENCRYPTION_KEY: "''" });
    expect(prazdny.status, "prázdný klíč sloupců musí start zastavit").not.toBe(0);
    expect(`${prazdny.stdout}${prazdny.stderr}`).not.toContain("ENTRYPOINT-START");
  });
});
