/**
 * Brána: bootstrap nesmí stát na tváři, kterou sám teprve tvoří.
 *
 * TŘÍDA VADY: krok, který něco VYDÁVÁ, si adresu vezme z cesty, která na to
 * vydání teprve čeká. Vznikne kruh — a protože každý článek zvlášť vypadá
 * rozumně, pozná se to až podle toho, že nic nenaběhne.
 *
 * NAMĚŘENO 2026-08-14 na aishe, v ostrém `--wipe` běhu:
 *
 *   pki-init:  Acquiring ROPC token from Keycloak (https://auth.aisha.guru realm=aisha)...
 *              ❌ Keycloak ROPC request failed: curl: (22) … error: 404
 *
 * `auth.<public-tld>` obsluhuje EDGE. Edge k tomu potřebuje mesh IP jádra.
 * Mesh vstane, jen když netbird-agenti projdou TLS na `netbird.mesh.<tld>`.
 * A ten certifikát vydává právě pki-init. Kruh se uzavřel a mesh nevstal:
 *
 *   [caddy-internal-tls] !!! WARN: no AISHA cert … Falling back to 'tls internal'
 *   netbird-agent: … remote error: tls: internal error   (×3 hostitelé)
 *
 * Keycloak má tři tváře a každá patří jinému stanovišti:
 *   MESH   — pro služby uvnitř mesh (vzniká až tímhle krokem)
 *   PUBLIC — pro svět, obsluhuje ji edge (potřebuje mesh)
 *   DIRECT — auth.backend.<internal-tld>, routuje Coolify proxy na backendu;
 *            nepotřebuje ani mesh, ani edge. Tohle je tvář bootstrapu.
 *
 * CO SE TU MĚŘÍ: compose se VYRENDERUJE s prostředím, kde se všechny tři tváře
 * liší, a kouká se na hodnotu, která z toho vyleze. Ne na text v souboru —
 * na adresu, kterou kontejner dostane.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";

const ROOT = resolve(process.cwd());
const COMPOSE = join(ROOT, "docker-compose.coolify-netbird.yml");

/** Tři tváře, každá jinak — aby se v renderu poznalo, která se použila. */
const PROSTREDI: Record<string, string> = {
  KEYCLOAK_DOMAIN: "auth.mesh.test-mesh",
  KEYCLOAK_DOMAIN_PUBLIC: "auth.verejna.test",
  KEYCLOAK_DOMAIN_DIRECT: "auth.backend.primatvar.test",
  KEYCLOAK_REALM: "aisha",
  APP_NAME_PREFIX: "testinst",
  NETBIRD_MESH_HOST: "netbird.mesh.test-mesh",
  PKI_BRIDGE_URL: "https://pki-bridge.test",
  PKI_BOOTSTRAP_CLIENT_ID: "aisha-pki-bootstrap",
  PKI_BOOTSTRAP_USERNAME: "aisha-pki-bootstrap",
  // ČTVRTÁ tvář: kontejnerová. Nepotřebuje mesh, edge, proxy ANI certifikát.
  KEYCLOAK_INTERNAL_URL: "http://testinst-keycloak:80",
};

/** Dosadí `${VAR}`, `${VAR:-default}` i `${VAR:?hláška}` — jako to dělá compose. */
function dosad(text: string): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([-?])([^}]*))?\}/g, (_, key, op, arg) => {
    const val = PROSTREDI[key];
    if (val !== undefined && val !== "") return val;
    if (op === "-") return arg ?? "";
    if (op === "?") throw new Error(`${key}: ${arg}`);
    return "";
  });
}

describe("bootstrap nestojí na tváři, kterou sám tvoří", () => {
  const doc = parse(readFileSync(COMPOSE, "utf-8")) as {
    services: Record<string, { environment?: Record<string, string> }>;
  };

  /** Tváře, které tenhle krok teprve VYTVÁŘÍ — opřít se o ně znamená kruh. */
  const ZAVISLE_TVARE = [
    [PROSTREDI.KEYCLOAK_DOMAIN, "mesh tvář vzniká až tím, co tenhle krok vydává"],
    [PROSTREDI.KEYCLOAK_DOMAIN_PUBLIC, "veřejnou tvář obsluhuje edge, a ten potřebuje mesh IP z tohoto certifikátu"],
  ] as const;

  test("adresa Keycloaku nesmí záviset na ničem, co tenhle krok teprve vydává", () => {
    const raw = doc.services["pki-init"]?.environment?.KEYCLOAK_URL;
    expect(raw, "pki-init musí dostat adresu Keycloaku").toBeTruthy();
    const url = dosad(String(raw));
    for (const [tvar, proc] of ZAVISLE_TVARE) {
      expect(
        url,
        `${proc} — vyrenderováno: ${url}\n` +
          "CO S TÍM: předej CELOU vnitřní URL (`${KEYCLOAK_INTERNAL_URL}` → http://<prefix>-keycloak:80),\n" +
          "tedy tvář, která nepotřebuje mesh, edge ani certifikát.\n" +
          "NEDĚLEJ: neopravuj to na jinou doménu se schématem — mesh i veřejná tvář vznikají\n" +
          "až tímhle krokem, takže kterákoli z nich je TÝŽ kruh, jen jinou cestou.",
      ).not.toContain(tvar);
    }
  });

  test("HTTPS na vnitřní jméno je TÝŽ kruh — certifikát pro ně vydává až tenhle krok", () => {
    // ⛔ NAMĚŘENO 2026-08-19 na riqi, v ostrém běhu pki-init:
    //   Acquiring ROPC token from Keycloak (https://<fork>-auth.backend.<fork>.internal ...)
    //   ❌ curl: (60) SSL: no alternative certificate subject name matches target
    //      hostname '<fork>-auth.backend.<fork>.internal'
    // Přímá tvář kruh přes edge rozťala, ale zůstal kruh přes DŮVĚRU: pro jméno
    // pod vnitřní TLD nevydá certifikát žádná veřejná CA a vnitřní CA je právě
    // to, co tenhle krok bootstrapuje. Proxy proto nabídne svůj vlastní a curl
    // ho odmítne. Jediná tvář bez kruhu je kontejnerová přes HTTP na privátní
    // síti — ověřeno týž den: Keycloak na ní ROPC PŘIJÍMÁ (vrátil regulérní
    // `unauthorized_client`, ne požadavek na HTTPS).
    const url = new URL(dosad(String(doc.services["pki-init"]?.environment?.KEYCLOAK_URL ?? "")));
    if (url.protocol === "https:") {
      expect(
        url.hostname.endsWith(".internal") || url.hostname.includes(".backend."),
        `vyrenderováno: ${url.href} — pro vnitřní jméno neexistuje ověřitelný certifikát dřív, ` +
          "než tenhle krok doběhne",
      ).toBe(false);
    }
  });

  test("prázdná tvář padá nahlas — mlčky dosadit prázdno by kruh jen vrátilo", () => {
    // Měří VLASTNOST („bez vstupu to spadne"), ne jméno konkrétní proměnné:
    // jinak brána zafixuje jednu odpověď a příští správnou označí za vadu.
    const raw = String(doc.services["pki-init"]?.environment?.KEYCLOAK_URL ?? "");
    expect(() => {
      raw.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([-?])([^}]*))?\}/g, (_, _key, op, arg) => {
        if (op === "-") return arg ?? "";
        if (op === "?") throw new Error(String(arg));
        return "";
      });
    }, "adresa se dosazuje bez `:?` — prázdno by prošlo tiše").toThrow();
  });
});

describe("hláška o certifikátu odpovídá tomu, co se servíruje", () => {
  /**
   * Vytáhne startovací větev z entrypointu a spustí ji nad dočasným /data.
   * Bere ji z ROZPARSOVANÉHO compose, ne ze syrového textu — v souboru je to
   * blokový skalár a odsazení by se do skriptu propsalo.
   */
  function startovaciHlaska(fallback: boolean): string {
    const doc = parse(readFileSync(COMPOSE, "utf-8")) as {
      services: Record<string, { command?: unknown }>;
    };
    const cmd = doc.services["netbird-internal-tls"]?.command;
    const skriptEntrypointu = Array.isArray(cmd) ? String(cmd[cmd.length - 1]) : String(cmd ?? "");
    const zacatek = skriptEntrypointu.indexOf("if [ -f /data/.tls-selfsigned-fallback ]; then");
    expect(zacatek, "startovací větev musí existovat").toBeGreaterThan(-1);
    const poHlasce = skriptEntrypointu.indexOf("s AISHA PKI certifikátem", zacatek);
    // `indexOf("fi")` by trefilo „certiFIkátem" — hledá se `fi` na SAMOSTATNÉM
    // řádku, tedy konec podmínky, ne kus slova.
    const konec = /\n\s*fi\b/.exec(skriptEntrypointu.slice(poHlasce));
    expect(konec, "konec podmínky se nenašel").toBeTruthy();
    const blok = skriptEntrypointu.slice(zacatek, poHlasce + (konec?.index ?? 0) + (konec?.[0].length ?? 0));

    const skript = [
      "set -eu",
      'D="$(mktemp -d)"',
      fallback ? ': > "$D/.tls-selfsigned-fallback"' : ":",
      blok.replace(/\/data\//g, '"$D"/'),
    ].join("\n");
    return execFileSync("bash", ["-c", skript], { encoding: "utf-8" }).trim();
  }

  test("se self-signed certifikátem to hláška PŘIZNÁ", () => {
    const out = startovaciHlaska(true);
    expect(out).toMatch(/SELF-SIGNED/);
    expect(out, "tvrdit „s AISHA PKI certifikátem\" nad self-signed je lež do logu").not.toMatch(
      /s AISHA PKI certifikátem/,
    );
  });

  test("s vydaným certifikátem hláška mluví o PKI", () => {
    expect(startovaciHlaska(false)).toMatch(/s AISHA PKI certifikátem/);
  });

  test("sonda degradovaný stav VYSLOVÍ — prázdný výstup nechá operátora bez stopy", () => {
    // Měří se SPUŠTĚNÍM, ne přítomností slova „echo" někde v příkazu: sonda se
    // pustí nad dočasným /data se sentinelem a musí (a) skončit nenulově a
    // (b) říct proč. Naměřeno 2026-08-14: FailingStreak 44, Output prázdný —
    // operátor viděl „unhealthy" a neměl jedinou stopu.
    const doc = parse(readFileSync(COMPOSE, "utf-8")) as {
      services: Record<string, { healthcheck?: { test?: unknown } }>;
    };
    const t = doc.services["netbird-internal-tls"]?.healthcheck?.test;
    const prikaz = Array.isArray(t) ? String(t[t.length - 1]) : String(t ?? "");
    expect(prikaz, "sonda musí existovat").toContain(".tls-selfsigned-fallback");

    let vystup = "";
    let kod = 0;
    try {
      vystup = execFileSync(
        "bash",
        ["-c", `D="$(mktemp -d)"; : > "$D/.tls-selfsigned-fallback"; ${prikaz.replace(/\/data\//g, '"$D"/')}`],
        { encoding: "utf-8" },
      );
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      kod = e.status ?? 1;
      vystup = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    expect(kod, "degradovaný stav musí být nenulový").not.toBe(0);
    expect(vystup.trim(), "a musí říct PROČ — prázdný výstup je mlčení, ne nález").not.toBe("");
    expect(vystup).toMatch(/DEGRADOV|self-signed|PKI/i);
  });
});

describe("brána bootstrapu volá Keycloak ze svého stanoviště", () => {
  // netbird-bootstrap.sh běží na OPERÁTORSKÉM stroji (mluví s NetBirdem přes
  // jeho veřejnou tvář). Do 2026-08-14 si adresu Keycloaku bral z vaultu, kde
  // stojí jméno UVNITŘ mesh — zvenčí nepřeložitelné. Sonda tak 183 s sbírala
  // HTTP 000 a pak odmítla bootstrap. Z cold-startu to procházelo, protože ten
  // si KEYCLOAK_URL exportoval jinak: adresa záležela na VOLAJÍCÍM, ne na tom,
  // kde skript běží.
  //
  // Měří se spuštěním: úsek, který adresu skládá, se vytáhne ze skriptu a pustí
  // nad prostředím, kde se vnitřní a veřejná tvář liší.
  const BOOTSTRAP = join(ROOT, "scripts/netbird-bootstrap.sh");

  function slozenaAdresa(env: Record<string, string>): string {
    const sh = readFileSync(BOOTSTRAP, "utf-8");
    const zacatek = sh.indexOf('KEYCLOAK_PUBLIC_DOMAIN="$(env_value KEYCLOAK_DOMAIN_PUBLIC)"');
    expect(zacatek, "skládání adresy musí ve skriptu existovat").toBeGreaterThan(-1);
    const konec = sh.indexOf("KEYCLOAK_DOMAIN=", zacatek);
    const blok = sh.slice(zacatek, sh.indexOf("\n", konec));

    // `env_value` je funkce skriptu (čte vault); pro tenhle test ji nahradíme
    // čtením prostředí — měří se ROZHODNUTÍ o tváři, ne parser vaultu.
    const skript = [
      "set -eu",
      'env_value() { eval "printf %s \\"\\${$1:-}\\""; }',
      blok,
      'printf "%s" "$KEYCLOAK_URL"',
    ].join("\n");
    return execFileSync("bash", ["-c", skript], {
      encoding: "utf-8",
      env: { PATH: process.env.PATH ?? "", ...env },
    });
  }

  test("veřejná tvář vyhraje nad vnitřní, i když vault nese vnitřní", () => {
    const url = slozenaAdresa({
      KEYCLOAK_URL: "https://auth.mesh.vnitrni.test",
      KEYCLOAK_DOMAIN: "auth.mesh.vnitrni.test",
      KEYCLOAK_DOMAIN_PUBLIC: "auth.verejna.test",
    });
    expect(url).toBe("https://auth.verejna.test");
  });

  test("bez deklarované veřejné tváře nevznikne adresa — a řekne se to tam, kde je potřeba", () => {
    // Skládání adresy samo NESMÍ shodit skript: existují cesty, které Keycloak
    // vůbec nepotřebují (SKIP_KEYCLOAK_GATE, statický NETBIRD_API_TOKEN, a taky
    // režim, ve kterém si skript jiná brána jen NASOURCUJE kvůli jedné funkci).
    // Fail-loud patří k místu POUŽITÍ — jinak nástroj odmítne nastartovat kvůli
    // hodnotě, kterou v daném běhu nikdy nesáhne. (Naměřeno: dřívější podoba
    // téhle opravy shodila bránu netbird-setup-key-identity, která skript
    // sourcuje s prázdným prostředím.)
    expect(slozenaAdresa({})).toBe("");
    const sh = readFileSync(BOOTSTRAP, "utf-8");
    const branaOd = sh.indexOf('if [ "${SKIP_KEYCLOAK_GATE:-0}" != "1" ]; then');
    expect(branaOd, "brána Keycloaku musí existovat").toBeGreaterThan(-1);
    const brana = sh.slice(branaOd, sh.indexOf("smoke-keycloak.sh", branaOd));
    expect(brana, "prázdná adresa se musí ohlásit tam, kde se používá").toMatch(
      /-z "\$KEYCLOAK_URL"[\s\S]{0,400}exit 1/,
    );
  });
});
