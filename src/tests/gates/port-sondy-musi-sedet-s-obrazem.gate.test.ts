/**
 * Brána: port v `expose:` a ve zdravotní sondě musí sedět s tím, co obraz otvírá.
 *
 * ⛔ NAMĚŘENO 2026-08-18 na běžícím serveru instance, appka `<fork>-extranet`:
 *
 *     Dockerfile        EXPOSE 8080          (nginx.conf: `listen 8080;`)
 *     compose           expose: "80"
 *     compose           healthcheck http://localhost:80/
 *     docker inspect    FailingStreak: 1592
 *
 * 1592 selhání v řadě je CELÝ ŽIVOT toho kontejneru — ta sonda neprošla ani
 * jednou. Přitom `wget http://127.0.0.1:8080/` uvnitř téhož kontejneru vrací
 * HTTP 200: aplikace celou dobu fungovala, měřilo se jen jinam.
 *
 * DŮSLEDEK NENÍ KOSMETICKÝ. Coolify z toho odvodil `running:unhealthy`, a proto
 * úloha `Deploy: Extranet` v CI padala: čeká na „healthy", které z principu
 * nemohlo přijít. Zároveň `expose:` řídí `traefik…loadbalancer.server.port`,
 * takže i veřejné směrování mířilo na port, kde nikdo neposlouchá.
 *
 * KDY VZNIKLA
 *     2026-07-27  f6140e424  nginx přešel na `listen 8080`
 *     2026-07-29  9419ebefd  compose vznikl se sondou na `:80`
 * Dva dny po přechodu. Nenarodila se z regrese — narodila se rozbitá, a proto
 * ji žádné porovnání „bylo/je" nemohlo chytit.
 *
 * ⚠️ DRUHÁ POLOVINA TÉŽE VADY: `localhost` se v tom obrazu překládá na `::1`,
 * ale nginx poslouchá jen na IPv4 (`0.0.0.0:8080`) — entrypointový skript
 * `10-listen-on-ipv6-by-default.sh` nemá co upravit, protože Dockerfile
 * `default.conf` maže. Oprava portu SAMA by tedy nestačila; sonda musí mířit
 * na `127.0.0.1`. Brána proto hlídá obojí.
 *
 * CO BRÁNA TVRDÍ
 * Deklaruje-li Dockerfile `EXPOSE N`, pak služba, která se z něj staví, musí
 * mít `expose: N` a sondu na port N. Odvozeno z repa, žádný seznam.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = join(__dirname, "../../..");

type Build = { context?: string; dockerfile?: string };
type Sluzba = { build?: string | Build; expose?: (string | number)[]; healthcheck?: { test?: unknown } };

function composeSoubory(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf-8" })
    .split("\n")
    .filter((p) => /(?:^|\/)docker-compose[^/]*\.ya?ml$/.test(p));
}

/** `EXPOSE N` z Dockerfilu — víc portů znamená, že brána o té službě mlčí. */
function exposeZDockerfilu(cesta: string): number[] {
  if (!existsSync(join(ROOT, cesta))) return [];
  const porty: number[] = [];
  for (const radek of readFileSync(join(ROOT, cesta), "utf8").split("\n")) {
    const m = radek.match(/^\s*EXPOSE\s+(.+)$/);
    if (!m) continue;
    for (const kus of m[1].trim().split(/\s+/)) {
      const n = parseInt(kus.split("/")[0], 10);
      if (Number.isFinite(n)) porty.push(n);
    }
  }
  return porty;
}

/** Porty, na které míří příkaz zdravotní sondy. */
function portySondy(test: unknown): { port: number; host: string }[] {
  const text = Array.isArray(test) ? test.join(" ") : String(test ?? "");
  const nalezy: { port: number; host: string }[] = [];
  for (const m of text.matchAll(/https?:\/\/([A-Za-z0-9_.:-]+?):(\d+)\b/g)) {
    nalezy.push({ host: m[1], port: parseInt(m[2], 10) });
  }
  return nalezy;
}

/**
 * Je ten obraz podle vlastní konfigurace IPv4-only?
 *
 * Měří se konfigurace, kterou Dockerfile do obrazu KOPÍRUJE: má-li nějaký
 * `listen`, ale ani jeden `listen [::]`, server IPv6 nedrží — a `localhost`,
 * který se uvnitř překládá na `::1`, na něj nedosáhne. U nginx obrazů to
 * navíc nespraví ani entrypoint: `10-listen-on-ipv6-by-default.sh` upravuje
 * `default.conf`, který Dockerfile maže.
 */
function jenIPv4(dockerfileCesta: string): boolean {
  const plna = join(ROOT, dockerfileCesta);
  if (!existsSync(plna)) return false;
  const adresar = dirname(dockerfileCesta);
  let maListen = false;
  for (const m of readFileSync(plna, "utf8").matchAll(/^\s*COPY\s+(?:--\S+\s+)*(\S+\.conf)\s/gm)) {
    const konf = join(ROOT, m[1].startsWith(adresar) ? m[1] : m[1]);
    if (!existsSync(konf)) continue;
    const text = readFileSync(konf, "utf8");
    if (/^\s*listen\s+\[::\]/m.test(text)) return false;
    if (/^\s*listen\s/m.test(text)) maListen = true;
  }
  return maListen;
}

describe("port sondy a `expose` musí sedět s tím, co obraz otvírá", () => {
  it("služba stavěná z Dockerfilu s `EXPOSE N` sonduje a vystavuje týž port", () => {
    const nalezy: string[] = [];
    let porovnano = 0;

    for (const soubor of composeSoubory()) {
      let dok: { services?: Record<string, Sluzba | null> };
      try {
        dok = parseYaml(readFileSync(join(ROOT, soubor), "utf8")) as typeof dok;
      } catch {
        continue; // nevalidní YAML řeší jiná brána
      }
      const zaklad = dirname(soubor).replace(/^\.$/, "");
      for (const [jmeno, def] of Object.entries(dok?.services ?? {})) {
        const build = def?.build;
        if (!build) continue;
        const df = typeof build === "string" ? "Dockerfile" : (build.dockerfile ?? "Dockerfile");
        const cesta = zaklad ? join(zaklad, df) : df;
        const porty = exposeZDockerfilu(cesta);
        // Žádný nebo víc než jeden EXPOSE → brána o té službě nic netvrdí.
        // Hádat, který z několika portů je „ten hlavní", by vyrábělo nálezy.
        if (porty.length !== 1) continue;
        const port = porty[0];
        porovnano++;

        for (const e of def?.expose ?? []) {
          const n = parseInt(String(e).split("/")[0], 10);
          if (Number.isFinite(n) && n !== port) {
            nalezy.push(`${soubor} → ${jmeno}: expose ${n}, ale ${cesta} otvírá ${port}`);
          }
        }
        for (const { host, port: p } of portySondy(def?.healthcheck?.test)) {
          if (p !== port) {
            nalezy.push(`${soubor} → ${jmeno}: sonda na :${p}, ale ${cesta} otvírá ${port}`);
          } else if (host === "localhost" && jenIPv4(cesta)) {
            // ⛔ Druhá polovina naměřené vady — ale JEN u obrazu, který je podle
            // vlastní konfigurace IPv4-only. První verze téhle brány pravidlo
            // zobecnila na každý `localhost` a označila mj. `pki-bridge`, který
            // na RIQi běží `Up 14 hours (healthy)`. Falešný nález z pravopisu:
            // rozhoduje, jestli server IPv6 drží, ne jak se ten host jmenuje.
            nalezy.push(
              `${soubor} → ${jmeno}: sonda na \`localhost\` — obraz poslouchá jen na IPv4 ` +
                "(nginx conf nemá `listen [::]`), ale `localhost` se v něm překládá na ::1. Použij 127.0.0.1.",
            );
          }
        }
      }
    }

    expect(porovnano, "žádná služba se nedala porovnat — brána by měřila prázdno").toBeGreaterThan(3);
    expect(
      nalezy,
      "Sonda mířící jinam, než kam obraz otvírá, NIKDY neprojde — a kontejner zůstane\n" +
        "trvale `unhealthy`, i když aplikace bezvadně odpovídá. Coolify z toho udělá\n" +
        "`running:unhealthy` a deploy úloha, která na „healthy\" čeká, padne.\n" +
        "`expose:` navíc řídí `traefik…loadbalancer.server.port`, takže neshoda posílá\n" +
        "i veřejný provoz na port, kde nikdo neposlouchá.\n  " +
        nalezy.join("\n  "),
    ).toEqual([]);
  });
});
