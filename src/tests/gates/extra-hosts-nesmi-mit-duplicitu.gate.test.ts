/**
 * Brána: dvě shodné položky v `extra_hosts` rozbijí celý stack
 *
 * ⛔ NAMĚŘENO 2026-09-04 na produkci forku. `<fork>-pki` se nenasadila:
 *
 *     validating docker-compose.coolify-pki.yml:
 *       services.pki-auth.extra_hosts must be a mapping
 *
 * Compose převádí seznam `extra_hosts` na MAPU, takže dvě SHODNÉ položky ji
 * rozbijí. Čtyři compose (pki, llm-gateway, monitoring, openclaw) měly:
 *
 *     - "${KEYCLOAK_DOMAIN_PUBLIC}:host-gateway"
 *     - "${KEYCLOAK_DOMAIN}:host-gateway"
 *
 * Na upstreamu se ty dvě domény liší. Na forku se OBĚ rovnaly
 * `auth.<fork-doména>`, takže vznikly dvě identické položky. Není to tedy vada
 * hodnot — reprodukováno lokálně se SPRÁVNÝMI hodnotami.
 *
 * Změřeno, co Compose přijímá:
 *
 *     dva shodné (seznam)  → services.a.extra_hosts must be a mapping
 *     dva různé  (seznam)  → OK
 *     dva shodné (mapa)    → mapping key "x.test" already defined
 *     dva různé  (mapa)    → OK
 *
 * Ani jeden tvar duplicitu nesnese a Compose neumí řádek podmíněně vynechat,
 * takže rozdílnost musí zaručit RESOLVER (`KEYCLOAK_EXTRA_HOST_ALIAS`:
 * kanonická doména, když se liší od veřejné, jinak `.invalid` sentinel).
 *
 * Brána měří to, co se rozbilo: pro každý profil × mesh on/off rozvine
 * proměnné z `extra_hosts` skutečnými hodnotami resolveru a hledá kolizi.
 * Kolize je v repu REPRODUKOVATELNÁ i bez instančních dat — `local-dev`
 * s vypnutým meshem má KEYCLOAK_DOMAIN i KEYCLOAK_DOMAIN_PUBLIC `auth.local`
 * — takže brána nestojí na privátním overlayi.
 *
 * Hlídá i druhou půlku: alias nesmí být sentinel tam, kde se domény LIŠÍ.
 * První verze opravy porovnávala `KEYCLOAK_DOMAIN_DIRECT` s veřejnou doménou,
 * jenže compose čte KANONICKOU `KEYCLOAK_DOMAIN` — na cloud-multi s meshem by
 * se mapování mesh jména na host-gateway tiše ZTRATILO. Odvozovat z jiné
 * veličiny, než jakou konzument čte, je táž třída vady jako celý incident.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();

const PROFILY = ["cloud-multi", "cloud-single", "local-dev"];
const MESH = ["on", "off"] as const;

/** Hodnoty resolveru pro daný profil a stav meshe. */
function hodnoty(profil: string, mesh: string): Record<string, string> {
  const out = execFileSync(
    "node",
    [join(ROOT, "scripts/lib/derive-domains.mjs"), "--shell", `--profile=${profil}`, `--mesh=${mesh}`],
    { encoding: "utf-8", env: { ...process.env, AISHA_PROFILE: profil }, stdio: ["ignore", "pipe", "ignore"] },
  );
  const mapa: Record<string, string> = {};
  for (const radek of out.split("\n")) {
    const m = /^([A-Z_0-9]+)=(.*)$/.exec(radek);
    if (m) mapa[m[1]] = m[2].replace(/^'|'$/g, "");
  }
  return mapa;
}

/** Bloky `extra_hosts` v compose: [služba, [jméno hostitele, …]]. */
function blokyExtraHosts(soubor: string): Array<{ sluzba: string; polozky: string[] }> {
  const L = readFileSync(join(ROOT, soubor), "utf8").split("\n");
  const bloky: Array<{ sluzba: string; polozky: string[] }> = [];
  let sluzba = "";
  for (let i = 0; i < L.length; i++) {
    const s = /^ {2}([a-z][a-z0-9_-]*):\s*$/.exec(L[i]);
    if (s) sluzba = s[1];
    if (!/^\s*extra_hosts:\s*$/.test(L[i])) continue;
    const polozky: string[] = [];
    for (let j = i + 1; j < L.length; j++) {
      if (/^\s*#/.test(L[j])) continue;
      const p = /^\s*-\s*"?([^":]+):/.exec(L[j]);
      if (!p) break;
      polozky.push(p[1]);
    }
    if (polozky.length > 1) bloky.push({ sluzba, polozky });
  }
  return bloky;
}

/**
 * Klíče MAPY v bloku `extra_hosts`, které jsou interpolované (`"${X}": …`).
 *
 * ⛔ NAMĚŘENO 2026-09-13. Compose interpoluje HODNOTY, ne KLÍČE mapy. Tvar
 *
 *     extra_hosts:
 *       "${KEYCLOAK_DOMAIN_PUBLIC}": "host-gateway"
 *
 * projde `docker compose config` s rc 0 — a kontejner dostane doslovné
 * `$${KEYCLOAK_DOMAIN_PUBLIC}=host-gateway`. Živě na giah (`docker inspect
 * n8n-auth-…`): `ExtraHosts: ["${KEYCLOAK_DOMAIN}:host-gateway", …]`. Mapování
 * na Keycloak tedy NIKDY neplatilo, jen to vypadalo, že prochází.
 *
 * Tahle brána to dřív neviděla: parser níž čte jen řádky `- "…"` a na prvním
 * jiném skončí, takže blok v mapové formě měl 0 položek a tiše vypadl z měření.
 * Mapu šíří i víra, že „kolaps zón snese" (duplicitní klíč, poslední vyhrává):
 * snese ho jen proto, že se klíče vůbec nerozvinou.
 */
export function interpolovaneKliceMapy(text: string): string[] {
  const L = text.split("\n");
  const nalezy: string[] = [];
  for (let i = 0; i < L.length; i++) {
    if (!/^\s*extra_hosts:\s*$/.test(L[i])) continue;
    const odsazeni = L[i].length - L[i].trimStart().length;
    for (let j = i + 1; j < L.length; j++) {
      const radek = L[j];
      if (radek.trim() === "" || /^\s*#/.test(radek)) continue;
      if (radek.length - radek.trimStart().length <= odsazeni) break;
      if (/^\s*["']?\$\{[A-Za-z_][A-Za-z0-9_]*[^}]*\}["']?\s*:/.test(radek)) nalezy.push(`ř. ${j + 1}: ${radek.trim()}`);
    }
  }
  return nalezy;
}

const COMPOSY = readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f));
const BLOKY = COMPOSY.flatMap((f) => blokyExtraHosts(f).map((b) => ({ soubor: f, ...b })));

describe("extra_hosts nesmí mít duplicitu", () => {
  test("compose i vícepoložkové bloky se našly (jinak brána nic neměří)", () => {
    expect(COMPOSY.length, "žádný docker-compose.coolify*.yml").toBeGreaterThan(0);
    expect(
      BLOKY.length,
      "žádný extra_hosts blok s víc než jednou položkou — brána by tiše prošla",
    ).toBeGreaterThan(0);
  });

  test.each(PROFILY.flatMap((p) => MESH.map((m) => [p, m] as const)))(
    "profil %s, mesh=%s: žádný blok nevydá dvě shodná jména",
    (profil, mesh) => {
      const env = hodnoty(profil, mesh);
      const nalezy: string[] = [];
      for (const b of BLOKY) {
        const rozvinute = b.polozky.map((p) =>
          p.replace(/\$\{([A-Z_0-9]+)(?::-[^}]*)?\}/g, (_, k) => env[k] ?? ""),
        );
        // Prázdné rozvinutí se NEPOČÍTÁ jako duplicita. Znamená jen, že tuhle
        // proměnnou resolver pro daný profil nevydává — hodnotu dodává
        // config/domains.env / .env.coolify (např. NETBIRD_MESH_HOST u
        // mesh-routeru). Prázdné jméno hostitele je vada taky, ale jiná: tu
        // měří preflight-compose.sh proti skutečnému env, ne tahle brána.
        const videno = new Map<string, number>();
        for (const h of rozvinute) {
          if (h === "") continue;
          videno.set(h, (videno.get(h) ?? 0) + 1);
        }
        for (const [h, n] of videno) {
          if (n > 1) nalezy.push(`  ${b.soubor} → ${b.sluzba}: '${h}' ${n}×`);
        }
      }
      expect(
        nalezy,
        `Tyhle bloky vydají dvě shodné položky:\n${nalezy.join("\n")}\n\n` +
          `Compose dělá z extra_hosts MAPU, takže duplicita ho shodí na\n` +
          `„must be a mapping" a stack se vůbec nenasadí (naměřeno 2026-09-04 na\n` +
          `<fork>-pki). Rozdílnost musí zaručit resolver — viz KEYCLOAK_EXTRA_HOST_ALIAS.`,
      ).toEqual([]);
    },
  );

  test("alias NENÍ sentinel tam, kde se domény liší", () => {
    // Druhá půlka kontraktu: sentinel smí zaskočit jen při skutečné kolizi.
    // Jinak by se mapování skutečného jména na host-gateway tiše ztratilo.
    const chyby: string[] = [];
    for (const profil of PROFILY) {
      for (const mesh of MESH) {
        const e = hodnoty(profil, mesh);
        const kolize = e.KEYCLOAK_DOMAIN === e.KEYCLOAK_DOMAIN_PUBLIC;
        const sentinel = (e.KEYCLOAK_EXTRA_HOST_ALIAS ?? "").endsWith(".invalid");
        if (kolize !== sentinel) {
          chyby.push(
            `  ${profil}/mesh=${mesh}: kolize=${kolize} ale alias='${e.KEYCLOAK_EXTRA_HOST_ALIAS}'`,
          );
        }
      }
    }
    expect(
      chyby,
      `Alias a skutečnost si neodpovídají:\n${chyby.join("\n")}\n\n` +
        `Sentinel patří JEN tam, kde by druhá položka splynula s první.`,
    ).toEqual([]);
  });

  test("žádný `extra_hosts` není MAPA s interpolovaným klíčem — Compose klíče nerozvine", () => {
    const nalezy = COMPOSY.flatMap((f) =>
      interpolovaneKliceMapy(readFileSync(join(ROOT, f), "utf8")).map((n) => `  ${f} ${n}`),
    );
    expect(
      nalezy,
      `Tyhle bloky jsou MAPA s interpolovaným klíčem:\n${nalezy.join("\n")}\n\n` +
        `Compose interpoluje hodnoty, ne klíče — kontejner dostane doslovné \`$\${X}\`\n` +
        `a mapování na host-gateway neplatí (naměřeno živě na giah, n8n-auth).\n` +
        `Použij SEZNAM a druhé jméno od resolveru:\n` +
        `  - "\${KEYCLOAK_DOMAIN_PUBLIC}:host-gateway"\n` +
        `  - "\${KEYCLOAK_EXTRA_HOST_ALIAS:?…}:host-gateway"`,
    ).toEqual([]);
  });

  test("negativní sonda: mapa s interpolovaným klíčem je nález, seznam a literální klíč ne", () => {
    const mapa = 'services:\n  a:\n    extra_hosts:\n      "${KEYCLOAK_DOMAIN}": "host-gateway"\n    environment:\n      X: "${Y}"\n';
    const holy = "services:\n  a:\n    extra_hosts:\n      ${KEYCLOAK_DOMAIN}: host-gateway\n";
    const seznam = 'services:\n  a:\n    extra_hosts:\n      - "${KEYCLOAK_DOMAIN}:host-gateway"\n';
    const literal = 'services:\n  a:\n    extra_hosts:\n      "auth.test": "host-gateway"\n';
    expect(interpolovaneKliceMapy(mapa)).toHaveLength(1);
    expect(interpolovaneKliceMapy(holy), "i bez uvozovek je to klíč mapy").toHaveLength(1);
    expect(interpolovaneKliceMapy(seznam), "seznam se interpoluje správně").toEqual([]);
    expect(interpolovaneKliceMapy(literal), "literální klíč se interpolovat nemusí").toEqual([]);
    // `environment:` za blokem se neměří — hodnoty proměnných se interpolují vždy.
    expect(interpolovaneKliceMapy(mapa).join(" ")).not.toContain("X:");
  });

  test("kolize je v repu vůbec dosažitelná (jinak brána měří prázdno)", () => {
    // local-dev s vypnutým meshem má obě domény `auth.local`. Kdyby tenhle
    // případ zmizel, brána výš by procházela triviálně a nikdo by si nevšiml.
    const e = hodnoty("local-dev", "off");
    expect(
      e.KEYCLOAK_DOMAIN,
      "local-dev/mesh=off už nekoliduje — najdi jiný reprodukovatelný případ, " +
        "jinak tahle brána nehlídá nic",
    ).toBe(e.KEYCLOAK_DOMAIN_PUBLIC);
  });
});
