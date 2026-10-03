/**
 * Gate: agent, který se zapisuje do meshe setup klíčem, musí umět POZNAT,
 * že už zapsaný je — a to podle stavu, který jeho verze SKUTEČNĚ píše.
 *
 * ⛔ NAMĚŘENO 2026-09-06
 * ---------------------
 * `live.<tld>` vracelo 502 i po opravě resolveru. Edge volal
 * `dial 100.112.246.17:3002: no route to host`, přestože ws-gateway běžel
 * a přes mesh se dostal na sdílenou redis. Mesh DNS totiž drželo adresu
 * PŘEDCHOZÍHO peeru: realtime agent se po nasazení zapsal jako NOVÝ peer
 * a dostal 100.112.14.89.
 *
 * Proč: podmínka pro „už jsem zapsaný" se ptala na `/etc/netbird/config.json`,
 * což je LEGACY cesta. NetBird 0.70 drží stav v `default.json` +
 * `active_profile.json`. Změřeno na běžících kontejnerech — 6 z 6 agentů
 * (včetně jiného nájemníka na témž stroji) mělo `default.json` a ŽÁDNÝ neměl
 * `config.json`. Podmínka tedy neplatila NIKDE a každý restart znamenal novou
 * identitu, novou mesh IP a osiřelý DNS záznam.
 *
 * ⭐ To je ta příčina, proč se „mesh DNS se neprovisionuje samo" vracelo dokola:
 * problém nebyl v provisioningu, ale v tom, že se identita ztrácela pod rukama.
 * Provisioning se pak honil za cílem, který se při každém nasazení posunul.
 *
 * Repo to přitom napůl vědělo: diagnostika v mesh-routeru si `default.json`
 * vypisuje a `/etc/netbird` označuje komentářem „legacy path". Jen ta podmínka
 * o tom nevěděla — znalost dosedla do prózy a ne do kódu.
 *
 * Brána tvrdí VLASTNOST, ne zápis: kde se předává `--setup-key`, tam se musí
 * detekce ptát i na stav 0.70. Legacy cesta smí zůstat (starší agenti), ale
 * nesmí být JEDINÁ.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

const composeSoubory = readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.yml$/.test(f));

/**
 * Text BEZ komentářů. ⛔ Naměřeno při psaní téhle brány: první verze hledala
 * `default.json` v celém souboru — a našla ho v PRÓZE, kterou oprava zrovna
 * přidala. Brána tak zůstala zelená i poté, co jsem kód schválně vrátil zpět.
 * Komentář není chování; ptát se musíme kódu.
 */
const bezKomentaru = (text: string) =>
  text
    .split("\n")
    .filter((r) => !/^\s*#/.test(r))
    .join("\n");

/** Soubory, jejichž entrypoint zapisuje agenta do meshe setup klíčem. */
const zapisujici = composeSoubory.filter((f) => /--setup-key/.test(read(f)));

describe("mesh — agent pozná, že už je zapsaný (jinak mění identitu při každém startu)", () => {
  test("nějaký zapisující agent existuje (jinak brána nic neměří)", () => {
    expect(zapisujici.length, "žádný compose nepředává --setup-key — detekce se rozešla se skutečností").toBeGreaterThan(5);
  });

  test.each(zapisujici)("%s: detekce stavu zná i layout NetBirdu 0.70", (soubor: string) => {
    const text = bezKomentaru(read(soubor));
    // Kde se rozhoduje mezi „reconnect" a „enroll", tam musí padnout jméno
    // souboru, který 0.70 opravdu píše. `config.json` sám o sobě NESTAČÍ.
    expect(
      /default\.json/.test(text),
      `${soubor} rozhoduje o zápisu do meshe jen podle legacy config.json.\n` +
        `NetBird 0.70 ho NEPÍŠE (změřeno na 6 z 6 běžících agentů), takže se agent\n` +
        `zapíše jako NOVÝ peer při každém startu — nová mesh IP a osiřelý DNS záznam.\n` +
        `Náprava: do detekce přidej /etc/netbird/default.json a /var/lib/netbird/default.json.`,
    ).toBe(true);
  });

  test("legacy cesta se nesmí ztratit (starší agenti ji ještě mají)", () => {
    const bezLegacy = zapisujici.filter((f) => !/config\.json/.test(bezKomentaru(read(f))));
    expect(
      bezLegacy,
      "detekce zahodila legacy config.json — agent, který ho ještě má, by se zapsal znovu",
    ).toEqual([]);
  });
});
