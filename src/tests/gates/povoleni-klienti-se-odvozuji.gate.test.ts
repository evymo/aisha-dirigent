import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Komu brána věří, se ODVOZUJE z deklarací — nevypisuje se do kódu.
 *
 * ⛔ PROČ EXISTUJE
 * `services/gateway/src/config.ts` nesl výčet klientů jako literál.
 * Naměřeno 2026-09-01: nasazená instance deklaruje tři vlastní klienty a na
 * seznamu nebyl ANI JEDEN, zatímco tam byli dva platformní, které nemá. Projevilo by se to jako
 * `keycloak_client_not_allowed`, tedy „přihlášení nefunguje" bez souvislosti
 * s příčinou.
 *
 * ⭐ ZDROJ JE DEKLARACE. Klienty zakládá `configure-realms.sh` z platformního
 * realmu a z instančního overlaye; seznam se skládá z týchž souborů, takže
 * pokrývá každou implementaci sám.
 *
 * ⚠️ Brána NEOVĚŘUJE, že seznam je pro danou instanci správný — to by
 * znamenalo mít po ruce overlay. Ověřuje, že se SKLÁDÁ, a ne vypisuje.
 */
const ROOT = join(__dirname, "../../..");
const GATEWAY = readFileSync(join(ROOT, "services/gateway/src/config.ts"), "utf8");
const DOCTOR = readFileSync(join(ROOT, "scripts/aisha-env-doctor.mjs"), "utf8");

describe("povolení OIDC klienti se odvozují, nevypisují", () => {
  it("brána nenese výčet klientů jako literál", () => {
    const radek = GATEWAY.split("\n").find((l) => l.includes("kcAllowedClients:")) ?? "";
    expect(
      /['"][a-z0-9-]+-(app|device|extranet)[,'"]/.test(radek),
      `kcAllowedClients nesmí obsahovat jména klientů: ${radek.trim()}`,
    ).toBe(false);
  });

  it("chybějící hodnota shodí bránu, nedosadí se", () => {
    expect(GATEWAY).toMatch(/kcAllowedClients:\s*requireEnv\('KC_ALLOWED_CLIENTS'/);
  });

  it("env-doctor tu proměnnou zná a skládá ji z obou deklarací", () => {
    expect(DOCTOR, "KC_ALLOWED_CLIENTS chybí v kontraktu").toMatch(
      /\["KC_ALLOWED_CLIENTS",\s*"derived"/,
    );
    expect(DOCTOR, "chybí platformní realm jako zdroj").toMatch(/aisha-realm\.json/);
    // Overlay se čte JEDINĚ přes rozcestník `scripts/lib/instance-overlay.mjs`
    // — hlídá to brána `overlay-jde-jen-jednemi-dvermi`, takže tady se ověřuje
    // ten sanctioned vstup, ne jméno proměnné. Režim dveří (`overlayDir` /
    // `overlayDirOrRequired`) volí konzument: od 2026-09-13 přísný, protože
    // instance s deklarovaným overlayem bez něj přišla o své klienty tiše.
    expect(DOCTOR, "overlay se musí číst přes rozcestník").toMatch(
      /overlayDir(?:OrRequired)?\([^)]*\)[\s\S]{0,500}-client\.json/,
    );
  });

  it("compose tu hodnotu DORUČÍ — jinak by brána nenastartovala", () => {
    // ⛔ TŘETÍ ČLÁNEK ŘETĚZU. Hodnota má domov (env-doctor) a konzumenta
    // (gateway), ale `coolify-sync-envs` posílá do appky JEN klíče, které její
    // compose zmiňuje. Bez tohohle řádku by `requireEnv` shodil bránu při
    // startu — a vypadalo by to jako vada služby, ne jako chybějící doručení.
    const compose = readFileSync(join(ROOT, "docker-compose.coolify.yml"), "utf8");
    expect(compose, "core compose nepředává KC_ALLOWED_CLIENTS bráně").toMatch(
      /KC_ALLOWED_CLIENTS:\s*\$\{KC_ALLOWED_CLIENTS/,
    );
    expect(
      /KC_ALLOWED_CLIENTS:\s*\$\{KC_ALLOWED_CLIENTS:-/.test(compose),
      "doručení nesmí mít prázdný fallback — prázdný seznam znamená nevěřit nikomu",
    ).toBe(false);
  });

  it("servisní účty se do seznamu nedostanou", () => {
    expect(DOCTOR).toMatch(/serviceAccountsEnabled\s*!==\s*true/);
  });
});
