/**
 * Brána: na identitu instance se klepe na JEDNY dveře — i z ověřovacích nástrojů.
 *
 * #905 postavil identitě domov: `lib/coolify-instance-scope.mjs` zná čtyři
 * kanály (prostředí → .env.local → .env-prod-backup → .env.coolify) a při
 * rozporu odmítne odpovědět. Nastěhoval se do něj ale jen cold-start.
 *
 * NAMĚŘENO 2026-08-14 v repu riqu, ve stejné minutě:
 *   coolify-instance-scope --identity-shell → APP_NAME_PREFIX=riq  (.env-prod-backup)
 *   resolveProjectName()                    → ""
 *
 * `resolveProjectName` totiž četl JEN `process.env`. Následek nebyl tichý, ale
 * ani srozumitelný: `npm run cold-start:verify` složil cestu k manifestu z
 * prázdného STORY (`coolify/manifests/.manifest`), spadl na ENOENT, a
 * derive-domains se mezitím vrátil k referenčnímu `cloud-single.json.example`.
 * Operátor viděl pád v souborovém systému, ne v identitě.
 *
 * Konzumenti téže funkce: cold-start-verify, coolify-deploy-watch,
 * generate-coolify-context, aisha-env-doctor a vnitřní resolveProjectUuid —
 * tedy celá ověřovací a pozorovací trať okolo nasazení.
 *
 * CO SE TU MĚŘÍ: spuštěním nad dočasným kořenem, kde identita žije JEN v
 * souboru. Ptát se prostředí umí každý; tahle brána se ptá, jestli se nástroj
 * dobere deklarace, kterou operátor napsal do vaultu.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveProjectName } from "../../../scripts/lib/coolify-project-scope.mjs";

const ROOT = resolve(process.cwd());

/** Kořen, kde identita stojí JEN v souboru — prostředí o ní neví. */
function korenSDeklaraciVSouboru(soubor: string, obsah: string): string {
  const dir = mkdtempSync(join(tmpdir(), "identita-"));
  writeFileSync(join(dir, soubor), obsah);
  return dir;
}

describe("identita instance má jedny dveře i pro ověřovací nástroje", () => {
  test("resolveProjectName najde deklaraci ve vaultu, i když prostředí mlčí", () => {
    const root = korenSDeklaraciVSouboru(".env-prod-backup", "APP_NAME_PREFIX=riq\n");
    // Prázdné prostředí + ukazatel na ten kořen: jediný zdroj odpovědi je soubor.
    expect(resolveProjectName({ AISHA_IDENTITY_ROOT: root } as NodeJS.ProcessEnv)).toBe("riq");
  });

  test("prostředí pořád vyhrává — deklarace „tady a teď\" je nejsilnější kanál", () => {
    const root = korenSDeklaraciVSouboru(".env-prod-backup", "APP_NAME_PREFIX=riq\n");
    expect(
      resolveProjectName({ AISHA_IDENTITY_ROOT: root, APP_NAME_PREFIX: "riq" } as NodeJS.ProcessEnv),
    ).toBe("riq");
  });

  test("dvě identity nejsou odpověď — rozpor kanálů odmítne, nevybere vítěze", () => {
    const root = korenSDeklaraciVSouboru(".env-prod-backup", "APP_NAME_PREFIX=riq\n");
    expect(() =>
      resolveProjectName({ AISHA_IDENTITY_ROOT: root, APP_NAME_PREFIX: "acme" } as NodeJS.ProcessEnv),
    ).toThrow(/ROZPORN/);
  });

  test("nedeklarovaná identita je prázdno, ne dosazená — volající si fail-closed řeší sám", () => {
    const root = korenSDeklaraciVSouboru(".env.neco", "NIC=1\n");
    expect(resolveProjectName({ AISHA_IDENTITY_ROOT: root } as NodeJS.ProcessEnv)).toBe("");
  });

  test("cold-start-verify složí cestu k manifestu z TÉHOŽ domova — i když prostředí mlčí", () => {
    // Tohle je ta pádová situace z riqu: identita žije JEN v souboru. Když si
    // verify vezme STORY z prostředí, vyjde prázdno a cesta se složí na
    // `coolify/manifests/.manifest` → ENOENT, tedy pád, který o instanci mlčí.
    // `--print-coverage` je jediný režim bez sítě; proto plán sond od téhle
    // opravy nese i to, ČÍ je — jinak by se ta otázka nedala změřit dřív,
    // než nástroj sáhne na produkci.
    const root = korenSDeklaraciVSouboru(".env-prod-backup", "APP_NAME_PREFIX=riq\n");
    const out = execFileSync(
      process.execPath,
      [join(ROOT, "scripts/cold-start-verify.mjs"), "--print-coverage"],
      {
        encoding: "utf-8",
        // Tvar nasazení se DEKLARUJE (od 2026-08-22 se nedosazuje) — tenhle
        // test měří identitu, ale nástroj potřebuje obojí.
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          AISHA_IDENTITY_ROOT: root,
          AISHA_PROFILE: "cloud-multi",
        },
      },
    );
    const plan = JSON.parse(out) as {
      identity?: { prefix?: string; story?: string; source?: string };
      manifest?: string;
    };
    expect(plan.identity?.prefix, "plán sond musí vědět, ČÍ instanci ověřuje").toBe("riq");
    expect(plan.identity?.story).toBe("riq");
    expect(plan.identity?.source, "a ze kterého kanálu to ví").toBe(".env-prod-backup");
    expect(plan.manifest, "prázdné STORY dělá z cesty `.manifest` → ENOENT").toBe(
      "coolify/manifests/riq.manifest",
    );
  });

  test("story a prefix se smějí rozejít — manifest jde za STORY, ne za prefixem", () => {
    // Dva pravopisy téže deklarace mají jednu společnou hodnotu jen ve výchozím
    // případě. Instance, která se přejmenovala (acme ← odbory naruby), nese
    // nové jméno projektu a starý manifest — a právě tam se pozná, jestli se
    // STORY ptá domova, nebo si ji jen dopočítává z prefixu.
    const root = korenSDeklaraciVSouboru(
      ".env-prod-backup",
      "APP_NAME_PREFIX=acme\nAISHA_STORY=odbory\n",
    );
    const out = execFileSync(
      process.execPath,
      [join(ROOT, "scripts/cold-start-verify.mjs"), "--print-coverage"],
      {
        encoding: "utf-8",
        // AISHA_PROFILE se DEKLARUJE i tady: tenhle test měří IDENTITU, ale
        // nástroj potřebuje znát i TVAR nasazení. Od 2026-08-22 se tvar
        // nedosazuje (dvě různá dosazení si odporovala), takže předpoklad,
        // který si test dřív mlčky půjčoval, musí teď říct nahlas.
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          AISHA_IDENTITY_ROOT: root,
          AISHA_PROFILE: "cloud-multi",
        },
      },
    );
    const plan = JSON.parse(out) as { identity?: { prefix?: string; story?: string }; manifest?: string };
    expect(plan.identity?.prefix).toBe("acme");
    expect(plan.identity?.story).toBe("odbory");
    expect(plan.manifest).toBe("coolify/manifests/odbory.manifest");
  });
});
