/**
 * Brána: KONZUMENTI CA BUNDLU SE ODVOZUJÍ, NEPÍŠÍ SE RUČNĚ (CLASS gate)
 *
 * ⛔ NAMĚŘENO 2026-08-22. `infra/pki/pki-renewer.sh` držel seznam ručně:
 *
 *     BUNDLE_CONSUMER_ROLES="${BUNDLE_CONSUMER_ROLES:-core integration local-ingest potok ledger netbird}"
 *
 * Tu proměnnou přitom NIKDO nikde nenastavoval — ani compose, ani .env.coolify —
 * takže těch šest rolí BYLO tou hodnotou ve 100 % běhů. Odvození z katalogu jich
 * najde 21. Seznam byl špatně v OBOU směrech:
 *   · chybělo 16 rolí, mimo jiné `pki` SÁM,
 *   · `netbird` tam byl navíc — komentář o dva řádky výš sám říká, že netbird
 *     používá certifikát z env, ne svazkový bundle.
 *
 * ⭐ NÁSLEDEK: při rotaci kořene CA se přenasadilo 6 z 21 stacků. Zbylým 15
 * zůstaly v `pki-certs` kotvy zmrazené 2026-04-13 a jejich netbird-agent
 * přestal věřit čemukoli (`x509: certificate signed by unknown authority`).
 * Protože `pki` je TVRDÁ brána, jeho nezdravý agent zastavil 27 aplikací
 * včetně databáze — a navenek to vypadalo jako „interní chyba serveru" při
 * přihlášení, tedy úplně jinde, než kde byla příčina.
 *
 * CO SE MĚŘÍ (vlastnost, ne pravopis):
 *   1. seznam se ODVOZUJE a odvození něco najde,
 *   2. nikde nezůstal RUČNÍ výčet rolí jako dosazená hodnota,
 *   3. hodnota je DEKLAROVANÁ po celé cestě (cold-start ji vydá, compose doručí),
 *   4. odvození umí odpovědět „nevím" — nečitelný compose je díra v pokrytí,
 *      ne nula konzumentů.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { odvodKonzumentyBundlu } from "../../../scripts/lib/derive-bundle-consumers.mjs";

const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

describe("konzumenti CA bundlu se odvozují", () => {
  const role = odvodKonzumentyBundlu(ROOT);

  test("odvození něco najde a všechny role zná katalog", () => {
    expect(role.length, "nula konzumentů — po rotaci CA by se nepřenasadilo nic").toBeGreaterThan(5);
    const katalog = JSON.parse(read("config/services.json"));
    const znamé = new Set(Object.keys(katalog.services ?? katalog));
    const cizi = role.filter((r) => !znamé.has(r));
    expect(cizi, "odvozená role, kterou katalog nezná — odvození si vymýšlí").toEqual([]);
  });

  test("v renewer skriptu nezůstal RUČNÍ výčet rolí", () => {
    const src = read("infra/pki/pki-renewer.sh")
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    // Dosazený výčet = `:-` následované víc než jedním slovem oddělených mezerami.
    const vycet = /BUNDLE_CONSUMER_ROLES="?\$\{BUNDLE_CONSUMER_ROLES:-[^}]*\s[^}]*\}/.exec(src);
    expect(
      vycet?.[0] ?? null,
      "Ručně psaný seznam se rozejde s realitou a projeví se to až tím, že\n" +
        "část stacků po rotaci kořene CA přestane věřit meshi. Odvoď ho.",
    ).toBeNull();
  });

  test("hodnota je DEKLAROVANÁ po celé cestě", () => {
    expect(
      read("scripts/aisha-cold-start.sh"),
      "cold-start hodnotu nevydává — pak ji nikdo nedoručí a stráž v renewer skriptu\n" +
        "zastaví každý běh.",
    ).toMatch(/BUNDLE_CONSUMER_ROLES=\$\{BUNDLE_CONSUMER_ROLES:\?/);
    expect(
      read("docker-compose.coolify-pki.yml"),
      "compose hodnotu nedoručuje do kontejneru renewer.",
    ).toMatch(/BUNDLE_CONSUMER_ROLES:/);
  });

  // ── Záporný test: odvození musí umět odpovědět „nevím" ────────────────────
  test("nečitelný compose je DÍRA, ne nula konzumentů", () => {
    const dir = join(tmpdir(), `bundle-gate-${process.pid}`);
    try {
      mkdirSync(join(dir, "config"), { recursive: true });
      writeFileSync(
        join(dir, "config/services.json"),
        JSON.stringify({ services: { rozbity: { compose: "docker-compose.rozbity.yml" } } }),
      );
      writeFileSync(join(dir, "docker-compose.rozbity.yml"), "services:\n  x: [ tohle: není: yaml\n");
      expect(
        () => odvodKonzumentyBundlu(dir),
        "Nečitelný compose se tiše přeskočil — odvození by tvrdilo čisto o nepřečteném.",
      ).toThrow(/nelze načíst/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
