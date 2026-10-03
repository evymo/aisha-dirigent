/**
 * Brána: kontrola „každý připnutý obraz jde stáhnout" je ZAPOJENÁ a nelže.
 *
 * Samotné měření proti registrům je online (scripts/registry/obraz-jde-stahnout.mjs,
 * jednotkové testy proti falešnému registru v téže složce). Tady se offline hlídá, že
 * ho nikdo potichu neodpojí: workflow běží pravidelně (obraz mizí bez změny v repu —
 * minio 2026-09-11 a 2026-09-24), stahuje, co skript importuje, a CHYBÍ shodí běh,
 * zatímco NEZMĚŘENO ne.
 *
 * Od 2026-09-27 měří i Dockerfile, které compose STAVÍ (kdekoli ve stromu, s args
 * buildu) — dřív jen kořenové, takže `clamav/clamav`, `pgvector/pgvector:pg${PG_MAJOR}`
 * a `nginx:alpine` neměřilo nic. Offline se tu hlídá, že řídký checkout každý takový
 * Dockerfile nese a že každý build má dosaditelný `FROM` (jinak by ho denní běh
 * jen varoval jako NEZMĚŘENO — tady to spadne už na PR).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { buildyZCompose, soupis } from "../../../scripts/registry/obraz-jde-stahnout.mjs";

const ROOT = process.cwd();
const WF = ".forgejo/workflows/obrazy-jdou-stahnout.yml";
const SKRIPT = "scripts/registry/obraz-jde-stahnout.mjs";

describe("obrazy jdou stáhnout — kontrola je zapojená", () => {
  const yml = existsSync(join(ROOT, WF)) ? readFileSync(join(ROOT, WF), "utf8") : "";
  const kod = yml
    .split("\n")
    .filter((r) => !r.trim().startsWith("#"))
    .join("\n");

  it("workflow existuje a běží PRAVIDELNĚ (cron) i na vyžádání", () => {
    expect({
      existuje: yml.length > 0,
      cron: /^\s*-\s*cron:\s*"[^"]+"/m.test(kod),
      dispatch: /^\s*workflow_dispatch:/m.test(kod),
    }).toEqual({ existuje: true, cron: true, dispatch: true });
  });

  it("volá měřicí skript a řídký checkout VÝSLOVNĚ nese piny, compose, Dockerfile, skript i jeho import", () => {
    const blok = kod.split("sparse-checkout: |")[1] ?? "";
    const sparse = blok.split("\n").slice(1).filter((r) => /^\s{12}\S/.test(r)).map((r) => r.trim());
    expect({
      vola: kod.includes(`node ${SKRIPT}`),
      bezCone: /sparse-checkout-cone-mode:\s*false/.test(kod),
      piny: sparse.includes("config/image-versions.env"),
      compose: sparse.includes("/docker-compose*.yml"),
      // BEZ úvodního lomítka = v každé hloubce (services/*, infra/*, deploy/* …).
      dockerfile: sparse.includes("Dockerfile*"),
      skript: sparse.includes(SKRIPT),
      importCliEntry: sparse.includes("scripts/lib/cli-entry.mjs"),
    }).toEqual({ vola: true, bezCone: true, piny: true, compose: true, dockerfile: true, skript: true, importCliEntry: true });
  });

  it("řídký checkout nese KAŽDÝ Dockerfile, který compose staví (vzory jako gitignore)", () => {
    const blok = kod.split("sparse-checkout: |")[1] ?? "";
    const vzory = blok.split("\n").slice(1).filter((r) => /^\s{12}\S/.test(r)).map((r) => r.trim());
    const naRegex = (v: string) => v.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
    const nese = (cesta: string) =>
      vzory.some((v) => {
        const ukotveny = v.startsWith("/") || v.replace(/\/$/, "").includes("/");
        const re = new RegExp(`^${naRegex(v.replace(/^\//, ""))}$`);
        return ukotveny ? re.test(cesta) : re.test(cesta.split("/").pop() ?? "");
      });
    const stavene = new Set<string>();
    for (const f of readdirSync(ROOT).filter((n) => /^docker-compose.*\.ya?ml$/.test(n))) {
      for (const b of buildyZCompose(readFileSync(join(ROOT, f), "utf8"))) stavene.add(normalize(join(b.context, b.dockerfile)));
    }
    expect(stavene.size, "compose musí něco stavět — jinak měřidlo neměří nic").toBeGreaterThan(10);
    expect([...stavene].filter((c) => !nese(c)).sort(), "Dockerfile, který denní běh neuvidí").toEqual([]);
  });

  it("každý build v compose má měřitelný zdroj — FROM dosaditelný, Dockerfile ve stromu (offline)", () => {
    const { seznam, nemeritelne } = soupis("config/image-versions.env", { koren: ROOT });
    // Kontrolní vzorek: měří se i podadresáře, ne jen kořen a piny.
    expect(seznam.some((s) => s.zdroje.some((z) => z.includes("/") && /Dockerfile/.test(z)))).toBe(true);
    expect(nemeritelne.map((n) => `${n.klic}: ${n.obraz} — ${n.duvod}`)).toEqual([]);
  });

  it("CHYBÍ (kód 1) shodí běh, NEZMĚŘENO (kód 2) ne — výpadek sítě není nález", () => {
    expect({
      chybiPada: /if \[ "\$rc" -eq 1 \]; then exit 1; fi/.test(kod),
      nezmerenoVaruje: /if \[ "\$rc" -eq 2 \]; then echo "::warning/.test(kod),
      zbytekZelena: /\n\s*exit 0\s*$/.test(kod.trimEnd() + "\n"),
    }).toEqual({ chybiPada: true, nezmerenoVaruje: true, zbytekZelena: true });
  });

  it("skript měří veřejný originál: ${REGISTRY_PROXY} se odstraňuje", () => {
    const s = readFileSync(join(ROOT, SKRIPT), "utf8");
    expect(s).toMatch(/replace\(\/\^\\\$\\\{REGISTRY_PROXY\[\^}\]\*\\\}\/, ""\)/);
  });
});
