/**
 * Brána: hodnota, která do buildu jde jako BuildKit secret, tam NESMÍ jít
 * zároveň jako build arg.
 *
 * ⛔ NAMĚŘENO 2026-08-18, stav před touto branou:
 *
 *     FORGEJO_TOKEN        secret ✓   build-time allowlist ✗   → chráněno
 *     SENTRY_AUTH_TOKEN    secret ✓   build-time allowlist ✓   → ÚNIK
 *
 * `Dockerfile.web:180` čte `SENTRY_AUTH_TOKEN` přes `--mount=type=secret` —
 * tedy přesně tou cestou, která se do vrstev ani do historie nezapisuje.
 * Jenže týž klíč zároveň vyhovuje `coolify_buildtime_key_regex()`, takže ho
 * Coolify označí jako build-time a pošle **navíc** jako `--build-arg`. Tím se
 * ochrana secretu ruší: dvě cesty pro jednu hodnotu, a rozhoduje ta slabší.
 *
 * Není to hypotéza. Sesterské měření 2026-08-15 na `svc-web-artifact`:
 * přes build ARG **2 výskyty** hodnoty v `docker history`, přes secret **0**.
 * Komentář u `secrets:` v docker-compose.coolify-keycloak.yml tu podmínku
 * dokonce vyslovuje („Coolify musí mít FORGEJO_TOKEN označený jako
 * runtime-only, jinak ho pošle jako `--build-arg` navíc a únik se vrátí") —
 * jen ji do té doby nic neměřilo. U jednoho klíče se to dodrželo, u druhého ne.
 * Prosa, kterou nikdo neměří, je přání.
 *
 * PROČ ODVOZENĚ A NE SEZNAMEM
 * Seznam citlivých jmen by měl tutéž vadu jako allowlist, který opravuje:
 * chytal by PRAVOPIS (`*_TOKEN`, `*_SECRET`) místo VLASTNOSTI. Brána proto
 * nic nepředpokládá o jménech — ptá se REPA: které hodnoty někdo vědomě
 * poslal jako secret? Ty a jenom ty musí být z build-time množiny venku.
 * Nový secret se pod bránu dostane sám, bez zásahu.
 *
 * ⚠️ ZDROJ PRAVDY, NE JEHO OPIS: regex se ČTE SPUŠTĚNÍM té shellové funkce,
 * ne přepsáním do testu. Kopie by se rozešla a brána by pak zeleně měřila
 * něco, co se v nasazení nepoužívá.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = join(__dirname, "../../..");

/** Soubory sledované gitem — univerzum si brána hledá, nepíše. */
function souboryVGitu(vzor: RegExp): string[] {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf-8" })
    .split("\n")
    .filter((p) => vzor.test(p));
}

/** `id` každého `--mount=type=secret` napříč všemi Dockerfily v repu. */
function idSecretuVDockerfilech(): Map<string, string[]> {
  const kdeSeBere = new Map<string, string[]>();
  for (const soubor of souboryVGitu(/(?:^|\/)Dockerfile[^/]*$/)) {
    const obsah = readFileSync(join(ROOT, soubor), "utf8");
    for (const m of obsah.matchAll(/--mount=type=secret,[^\s\\]*\bid=([A-Za-z0-9_.-]+)/g)) {
      const seznam = kdeSeBere.get(m[1]) ?? [];
      seznam.push(soubor);
      kdeSeBere.set(m[1], seznam);
    }
  }
  return kdeSeBere;
}

/** Mapa `id secretu → jméno env klíče` z vrcholové sekce `secrets:` compose souborů. */
function mapaIdNaKlic(): Map<string, { klic: string; soubor: string }> {
  const mapa = new Map<string, { klic: string; soubor: string }>();
  for (const soubor of souboryVGitu(/(?:^|\/)docker-compose[^/]*\.ya?ml$/)) {
    let dokument: { secrets?: Record<string, { environment?: string } | null> };
    try {
      dokument = parseYaml(readFileSync(join(ROOT, soubor), "utf8")) as typeof dokument;
    } catch {
      continue; // nevalidní YAML řeší jiná brána
    }
    for (const [id, def] of Object.entries(dokument?.secrets ?? {})) {
      const klic = def?.environment;
      if (klic) mapa.set(id, { klic, soubor });
    }
  }
  return mapa;
}

/**
 * Build-time allowlist se čte SPUŠTĚNÍM zdrojové funkce. Kdyby se helper
 * přestal načítat, spadne to tady — ne tiše o test níž.
 */
function buildTimeRegex(): RegExp {
  const vypis = execFileSync(
    "bash",
    ["-c", '. scripts/lib/coolify-buildtime-envs.sh && coolify_buildtime_key_regex'],
    { cwd: ROOT, encoding: "utf-8" },
  ).trim();
  expect(vypis.length, "coolify_buildtime_key_regex() nevrátila nic — brána by měřila prázdno").toBeGreaterThan(20);
  return new RegExp(vypis);
}

describe("hodnota poslaná jako BuildKit secret nesmí jít zároveň jako build arg", () => {
  it("žádný klíč doručovaný přes `secrets:` není v build-time allowlistu", () => {
    const idVDockerfilech = idSecretuVDockerfilech();
    const idNaKlic = mapaIdNaKlic();
    const regex = buildTimeRegex();

    // Sonda musí doložit, že vůbec měřila — a to na OBOU stranách kontraktu.
    expect(idVDockerfilech.size, "žádný Dockerfile nepoužívá `--mount=type=secret` — verdikt by nic neznamenal").toBeGreaterThan(0);
    expect(idNaKlic.size, "žádný compose nemapuje secret na env klíč — verdikt by nic neznamenal").toBeGreaterThan(0);

    const nalezy: string[] = [];
    for (const [id, dockerfily] of idVDockerfilech) {
      const mapovani = idNaKlic.get(id);
      // Bez mapování v compose brána nic netvrdí: takový secret může doručovat
      // Coolify sám a jméno klíče odsud neplyne. Mlčet je správně.
      if (!mapovani) continue;
      if (!regex.test(mapovani.klic)) continue;
      nalezy.push(
        `${mapovani.klic}: secret \`${id}\` čte ${dockerfily.join(", ")}, ` +
          `mapuje ${mapovani.soubor} — a zároveň vyhovuje build-time allowlistu`,
      );
    }

    expect(
      nalezy,
      "Klíč označený build-time posílá Coolify NAVÍC jako `--build-arg` a ten se\n" +
        "zapisuje do metadat obrazu — `docker history` ho vydá komukoli, kdo na obraz\n" +
        "dosáhne, a napořád. Tím je ochrana `--mount=type=secret` zrušená: hodnota\n" +
        "cestuje dvěma cestami a rozhoduje ta slabší.\n" +
        "Náprava: klíč VYJMOUT z `coolify_buildtime_key_regex()`. Compose ho dostane\n" +
        "tak jako tak — `.env` čte při interpolaci VŠECHNY hodnoty, build-time příznak\n" +
        "k tomu nepotřebuje.\n  " +
        nalezy.join("\n  "),
    ).toEqual([]);
  });

  it("allowlist dál propouští klíče, které compose potřebuje při parsování", () => {
    // ⛔ Kotva proti „opravě" zúžením do prázdna: kdyby někdo regex vyprázdnil,
    // horní test by zezelenal a PRVNÍ deploy čerstvé aplikace by umřel na
    // "required variable X is missing a value" — táž třída pádu jako
    // netbird 2026-08-14. Zelená se nesmí dát koupit vypnutím měřidla.
    const regex = buildTimeRegex();
    for (const klic of ["REGISTRY_PROXY", "IMAGE_NETBIRD", "MESH_DNS_SUBNET", "APP_NAME_PREFIX"]) {
      expect(regex.test(klic), `${klic} musí zůstat build-time — compose ho čte při parsování`).toBe(true);
    }
  });
});
