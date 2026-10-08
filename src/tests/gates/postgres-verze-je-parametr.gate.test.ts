/**
 * Major verze PostgreSQL je parametr instance — a data se nesmí minout s obrazem
 *
 * TŘÍDA VADY: verze databáze je vlastnost DAT, ne souboru. Když ji nese literál
 * (`pgvector:pg17`, `postgresql-17-*`), změna literálu přepne každou instanci
 * při příštím buildu — a obraz jiné major verze nad existujícími daty buď
 * nenastartuje, nebo (hůř) nastartuje prázdný cluster vedle nich.
 *
 * NAMĚŘENO 2026-09-13/14:
 *  - obraz `pgvector:pg18` má `PGDATA=/var/lib/postgresql/18/docker` a
 *    `VOLUME /var/lib/postgresql`; náš mount `db-data:/var/lib/postgresql/data`
 *    by bez výslovného PGDATA minul → prázdný cluster BEZ chyby;
 *  - zkouška dump/restore produkční kopie 17 → 18: 0 rozdílů katalogu i dat.
 *
 * INVARIANTY (každý zavírá jinou cestu zpět):
 *  1. Dockerfile: `ARG PG_MAJOR` BEZ výchozí hodnoty, FROM i balíky z něj,
 *     `ENV PGDATA` výslovně.
 *  2. PGDATA obrazu = cíl mountu dat služby `db` = `pg1-path` pgBackRestu.
 *  3. Compose staví `infra/postgres` s `PG_MAJOR: ${POSTGRES_MAJOR:?…}` (bez
 *     fallbacku) a domov `POSTGRES_MAJOR` je v config/image-versions.env.
 *  4. Každý `docker build` obrazu `infra/postgres` ve workflowech a skriptech
 *     předává PG_MAJOR (univerzum se hledá).
 *  5. Wrapper odmítne data jiné major verze.
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { duvodVynechanoSnapshotem } from "./lib/vynechano-snapshotem";

const ROOT = process.cwd();
const cti = (p: string) => readFileSync(join(ROOT, p), "utf8");
const DOCKERFILE = cti("infra/postgres/Dockerfile");

describe("postgres: major verze je parametr", () => {
  test("Dockerfile bere verzi z ARG PG_MAJOR bez výchozí hodnoty a PGDATA výslovně", () => {
    const predFrom = DOCKERFILE.split(/^FROM /m)[0];
    expect(predFrom, "ARG PG_MAJOR před FROM (bez `=` — chybějící verze má build shodit)").toMatch(/^ARG PG_MAJOR\s*$/m);
    expect(DOCKERFILE).toMatch(/^FROM \$\{REGISTRY_PROXY\}pgvector\/pgvector:pg\$\{PG_MAJOR\}\s*$/m);
    const literal = DOCKERFILE.split("\n").filter((l) => !l.trim().startsWith("#") && /pg1[0-9]\b|postgresql-1[0-9]-/.test(l));
    expect(literal, "verze napevno v nekomentovaném řádku").toEqual([]);
    expect(DOCKERFILE).toMatch(/postgresql-\$\{PG_MAJOR\}-pgaudit/);
    expect(DOCKERFILE).toMatch(/^\s*PGDATA=\/var\/lib\/postgresql\/data\s*$|^ENV PGDATA=\/var\/lib\/postgresql\/data\s*$/m);
  });

  test("PGDATA obrazu = mount dat služby db = pg1-path pgBackRestu", () => {
    const pgdata = DOCKERFILE.match(/PGDATA=(\S+)/)?.[1];
    expect(pgdata).toBeTruthy();
    const compose = parse(cti("docker-compose.coolify.yml")) as { services: Record<string, { volumes?: string[] }> };
    const cileDb = (compose.services.db.volumes ?? []).map((v) => String(v).split(":")[1]);
    expect(cileDb, "služba db musí mountovat data přesně do PGDATA obrazu").toContain(pgdata);
    expect(cti("infra/postgres/pgbackrest.conf")).toMatch(new RegExp(`^pg1-path=${pgdata}\\s*$`, "m"));
  });

  test("compose předává PG_MAJOR z POSTGRES_MAJOR bez fallbacku a domov existuje", () => {
    const compose = parse(cti("docker-compose.coolify.yml")) as {
      services: Record<string, { build?: { context?: string; args?: Record<string, string> } }>;
    };
    const stavitele = Object.entries(compose.services).filter(([, s]) => s.build?.context === "infra/postgres");
    expect(stavitele.map(([n]) => n).sort(), "db i pgbackrest stojí na témž obrazu").toEqual(["db", "pgbackrest"]);
    for (const [jmeno, s] of stavitele) {
      expect(s.build?.args?.PG_MAJOR, `${jmeno}: PG_MAJOR`).toMatch(/^\$\{POSTGRES_MAJOR:\?/);
    }
    expect(cti("config/image-versions.env")).toMatch(/^POSTGRES_MAJOR=[1-9][0-9]\s*$/m);
    expect(cti("scripts/aisha-env-doctor.mjs")).toMatch(/\["POSTGRES_MAJOR", "required-static"/);
  });

  test("každý docker build infra/postgres předává PG_MAJOR", () => {
    // Strom se prochází (ne `git ls-files`): brána bez podprocesu zůstává v lehké
    // dráze (rohatka drahy-bran-manifest).
    const soubory: string[] = [];
    const projdi = (rel: string) => {
      for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
        if (e.name === "node_modules") continue;
        const cesta = `${rel}/${e.name}`;
        if (e.isDirectory()) projdi(cesta);
        else if (/\.(ya?ml|sh|mjs|cjs|js)$/.test(e.name) && !/\.test\.(mjs|js)$/.test(e.name)) soubory.push(cesta);
      }
    };
    // Kořen, který veřejný snapshot nevozí (`.github/workflows/`), se neprochází —
    // v tomhle stromu není; upstream ho má a měří. Chybějící kořen BEZ důvodu
    // dál padá na ENOENT (vada, ne snapshot).
    for (const kořen of [".github/workflows", "scripts"]) {
      if (duvodVynechanoSnapshotem(`${kořen}/`) === null) projdi(kořen);
    }
    const volani: string[] = [];
    for (const f of soubory) {
      const radky = cti(f).split("\n");
      for (let i = 0; i < radky.length; i++) {
        let text = radky[i];
        const start = i + 1;
        while (/\\\s*$/.test(text) && i + 1 < radky.length) text = text.replace(/\\\s*$/, " ") + radky[++i];
        const t = text.trim();
        if (/^(#|\/\/|\/?\*)/.test(t) || !/infra\/postgres/.test(t)) continue;
        if (!/docker\s+build\b|["'`]build["'`]/.test(t)) continue;
        volani.push(`${f}:${start}|${t}`);
      }
    }
    // Kontrolní vzorek: bez nálezu by test prošel naprázdno.
    expect(volani.length, "žádný build infra/postgres — detektor je slepý").toBeGreaterThanOrEqual(3);
    const bez = volani.filter((v) => !/PG_MAJOR|postgresMajorBuildArgs\(/.test(v));
    expect(bez, "build infra/postgres bez PG_MAJOR").toEqual([]);
  });

  test("wrapper odmítne data jiné major verze", () => {
    const w = cti("infra/postgres/entrypoint-wrapper.sh");
    const guard = w.indexOf('"$DATA_MAJOR" != "$PG_MAJOR"');
    const fresh = w.indexOf('if [ ! -s "$PGDATA/PG_VERSION" ]');
    expect(guard, "kontrola verze dat chybí").toBeGreaterThan(-1);
    expect(fresh).toBeGreaterThan(-1);
    expect(guard, "kontrola musí proběhnout PŘED předáním docker-entrypoint.sh").toBeLessThan(fresh);
    expect(w, "wrapper nesmí mít cestu dat napevno").not.toMatch(/\/var\/lib\/postgresql\/data\/PG_VERSION/);
  });
});
