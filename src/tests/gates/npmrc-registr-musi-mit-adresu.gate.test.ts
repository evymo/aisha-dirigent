/**
 * Brána: proměnná, ze které `.npmrc` skládá ADRESU REGISTRU, musí být build-time.
 *
 * ⛔ NAMĚŘENO 2026-08-18 — moje vlastní oprava tuhle vadu vyrobila a odhalil ji
 * až skutečný build extranetu:
 *
 *     npm error code ERR_INVALID_URL
 *
 * Vyhodil jsem `VERDACCIO_(TOKEN|URL)` z build-time allowlistu s odůvodněním
 * „nikdo je nekonzumuje". Měřil jsem `ARG` v Dockerfilech a `${VAR}` v compose
 * — a MINUL `.npmrc`. Ten leží v kořeni repa, `.dockerignore` ho nevyřazuje
 * a `COPY . .` ho doveze do každého buildu, který dělá `npm ci`:
 *
 *     @aisha:registry=${VERDACCIO_URL}
 *
 * Univerzum měření mělo díru a závěr ji zdědil. Klasika: brána (i člověk)
 * zdědí díry svého vstupního seznamu.
 *
 * PROČ ZROVNA `registry=` A NE VŠECHNO
 * Rozdíl mezi těmi dvěma řádky `.npmrc` je ZMĚŘENÝ, ne odhadnutý:
 *
 *     prázdná URL     → npm vrátí literál `${VERDACCIO_URL}` → ERR_INVALID_URL,
 *                       a to při načítání KONFIGURACE, tedy dřív než cokoli jiného
 *     prázdný token   → `npm view @aisha/extranet-sdk-ui` vrátí 0.3.1
 *
 * `_authToken` smí být prázdný (čtení `@aisha/*` je anonymní) a NEMÁ být
 * build-time: zapsal by se do `docker history`. Adresa registru tajemství není
 * a bez ní build nevznikne. Brána proto rozlišuje podle ROLE nastavení, ne
 * podle jména proměnné — jméno by byl zase pravopis.
 *
 * ⚠️ npm `${VAR}` NEROZVINE na prázdno, když proměnná chybí — nechá tam
 * literál. Tichý default by byl lepší; tenhle je hlasitý, ale pozdě: padá až
 * uvnitř `npm ci`, kde to vypadá jako závada sítě nebo registru.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");

/** Proměnné, ze kterých `.npmrc` skládá adresu registru. */
function promenneVAdreseRegistru(): { klic: string; radek: string }[] {
  const cesta = join(ROOT, ".npmrc");
  expect(existsSync(cesta), ".npmrc v kořeni repa není — brána by měřila prázdno").toBe(true);
  const nalezy: { klic: string; radek: string }[] = [];
  for (const radek of readFileSync(cesta, "utf8").split("\n")) {
    const cisty = radek.replace(/^\s*[#;].*$/, "").trim();
    if (!cisty) continue;
    // Nastavení, jehož hodnota je adresa: `registry=`, `@scope:registry=`.
    if (!/(?:^|:)registry\s*=/.test(cisty)) continue;
    for (const m of cisty.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
      nalezy.push({ klic: m[1], radek: cisty });
    }
  }
  return nalezy;
}

function buildTimeRegex(): RegExp {
  const vypis = execFileSync(
    "bash",
    ["-c", ". scripts/lib/coolify-buildtime-envs.sh && coolify_buildtime_key_regex"],
    { cwd: ROOT, encoding: "utf-8" },
  ).trim();
  expect(vypis.length, "coolify_buildtime_key_regex() nevrátila nic — brána by měřila prázdno").toBeGreaterThan(20);
  return new RegExp(vypis);
}

describe("adresa registru v .npmrc musí do buildu dorazit", () => {
  it("každá proměnná v `registry=` je v build-time allowlistu", () => {
    const promenne = promenneVAdreseRegistru();
    const regex = buildTimeRegex();

    // Sonda musí doložit, že měřila.
    expect(
      promenne.length,
      ".npmrc neskládá adresu registru z žádné proměnné — verdikt by nic neznamenal.\n" +
        "Buď se to přepsalo natvrdo (pak tahle brána doslouží), nebo se rozbil parser.",
    ).toBeGreaterThan(0);

    const chybejici = promenne
      .filter(({ klic }) => !regex.test(klic))
      .map(({ klic, radek }) => `${klic} (${radek})`);

    expect(
      chybejici,
      "Proměnná, ze které `.npmrc` skládá adresu registru, musí být v Coolify\n" +
        "build-time — jinak ji `docker compose build` nedostane, npm nechá v konfiguraci\n" +
        "literál `${VAR}} a `npm ci` padne na ERR_INVALID_URL. `.npmrc` je v kontextu\n" +
        "každého buildu (`.dockerignore` ho nevyřazuje), takže se to týká VŠECH služeb,\n" +
        "které dělají `npm ci`.\n" +
        "Náprava: klíč vrátit do `coolify_buildtime_key_regex()`. Je to adresa, ne\n" +
        "tajemství — do `docker history` patřit může.\n  " +
        chybejici.join("\n  "),
    ).toEqual([]);
  });

  it("tokeny v .npmrc build-time NEJSOU — prázdný token je snesitelný, únik ne", () => {
    // ⛔ Druhá strana téhož kontraktu. Bez ní by šlo horní tvrzení „opravit"
    // tím, že se do allowlistu vrátí všechno včetně tajemství.
    // Změřeno 2026-08-18: s prázdným `_authToken` vrátí `npm view
    // @aisha/extranet-sdk-ui version` hodnotu 0.3.1 — čtení `@aisha/*` je
    // anonymní. Token je potřeba jen na publish, a ten neběží v buildu.
    const cesta = join(ROOT, ".npmrc");
    const regex = buildTimeRegex();
    const tokeny: string[] = [];
    for (const radek of readFileSync(cesta, "utf8").split("\n")) {
      const cisty = radek.replace(/^\s*[#;].*$/, "").trim();
      if (!/(?:_authToken|_auth|_password)\s*=/.test(cisty)) continue;
      for (const m of cisty.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
        if (regex.test(m[1])) tokeny.push(`${m[1]} (${cisty.split("=")[0]}=…)`);
      }
    }
    expect(
      tokeny,
      "Pověření z `.npmrc` označené build-time pošle Coolify jako `--build-arg`\n" +
        "a hodnota skončí v metadatech obrazu napořád. Prázdné pověření build\n" +
        "nerozbije (čtení @aisha/* je anonymní), únik ano.\n" +
        "Náprava: klíč z `coolify_buildtime_key_regex()` VYNDAT. Je-li pověření\n" +
        "opravdu potřeba, patří přes `--mount=type=secret`, ne přes build arg.\n  " +
        tokeny.join("\n  "),
    ).toEqual([]);
  });
});
