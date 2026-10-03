/**
 * Brána: realm musí znát KAŽDOU obsluhovanou doménu.
 *
 * ⛔ NAMĚŘENO 2026-09-01. `sync-aisha-app-redirects.mjs` stavěl množinu
 * redirect URI JEN z generických vzorů (`web.${PUBLIC_TLD}`, `api.${PUBLIC_TLD}`).
 * Instance, která obsluhuje jiné hostnames — a to dělá každá multi-brand — je do
 * realmu nedostala vůbec. Přihlášení na brand doméně pak skončí na
 * `invalid_redirect_uri`, přestože doména je řádně deklarovaná ve `WEB_FQDNS`.
 * `webOrigins` se nesynchronizovaly ani omylem, takže i po opravě redirectu by
 * prohlížeč zablokoval CORS preflight.
 *
 * Je to táž třída vady jako mrtvý doménový overlay: DEKLARACE existuje, ale nic
 * ji nedoručí tam, kde se má projevit.
 *
 * Brána drží tři invarianty té opravy. Každý je negativně testovatelný.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");
const SRC = readFileSync(join(ROOT, "scripts/keycloak/sync-aisha-app-redirects.mjs"), "utf-8");

describe("realm zná obsluhované domény", () => {
  test("redirect URI se ODVOZUJÍ z WEB_FQDNS, ne jen z generických vzorů", () => {
    // ⛔ Nestačí, že se `WEB_FQDNS` ve skriptu VYSKYTNE — to projde i tehdy, když
    // se proměnná načte a pak zahodí. Měří se KOMPOZICE: odvozené callbacky musí
    // skutečně téct do množiny, kterou sync zapisuje do klienta.
    expect(
      SRC,
      "z obsluhovaných hostů se neodvozují callbacky — chybí mapování WEB_FQDNS → /auth/callback",
    ).toMatch(/WEB_FQDNS\.flatMap\(\s*callbacksFor\s*\)/);

    const required = SRC.match(/const REQUIRED_REDIRECT_URIS = \[([\s\S]*?)\n\];/);
    expect(required, "REQUIRED_REDIRECT_URIS nenalezeno").not.toBeNull();
    expect(
      required![1],
      "REQUIRED_REDIRECT_URIS se neskládá z obsluhovaných domén — odvození existuje, " +
        "ale do zapisované množiny nevede, takže brand doména do realmu nedorazí",
    ).toMatch(/\.\.\.SERVED_REDIRECT_URIS/);
  });

  test("webOrigins se skutečně ZAPISUJÍ do klienta", () => {
    // Nestačí, že se `webOrigins` ve skriptu vyskytne — musí být v těle PUT.
    // Bez nich by redirect seděl, ale prohlížeč požadavek zablokuje na CORS
    // preflightu a chyba se projeví až v konzoli, ne v Keycloaku.
    const body = SRC.match(/body:\s*JSON\.stringify\(\{([\s\S]*?)\}\)/);
    expect(body, "tělo PUT požadavku nenalezeno").not.toBeNull();
    expect(body![1], "webOrigins se do klienta nezapisují").toMatch(/\bwebOrigins\b/);
    expect(body![1], "redirectUris se do klienta nezapisují").toMatch(/\bredirectUris\b/);
    expect(SRC, "ALLOWED_ORIGINS se nečte").toMatch(/ALLOWED_ORIGINS/);
  });

  test("PROVOZ JE CHRÁNĚNÝ: sync jen přidává, nikdy nemaže", () => {
    // ⛔ Tohle je nejdůležitější invariant celé opravy — důležitější než warmup.
    // Warmup se dá zopakovat; PRÁCE UŽIVATELŮ ne. Redirect URI a origins, které
    // správce přidal v administraci za běhu, jsou provozní stav. Kdyby je deploy
    // přepisoval, každé nasazení by potichu zahodilo konfiguraci, na kterou se
    // někdo spoléhá — a projevilo by se to až tím, že se lidé nepřihlásí.
    //
    // Obě pole proto MUSÍ vzniknout sloučením se stávajícím stavem klienta.
    for (const field of ["currentUris", "currentOrigins"]) {
      const re = new RegExp(`new Set\\(\\[\\s*\\.\\.\\.${field}\\b`);
      expect(
        SRC,
        `pole odvozené od ${field} nevzniká sloučením — deploy by přepsal provozní stav`,
      ).toMatch(re);
    }
    // A žádné z obou polí se nesmí do klienta zapsat z množiny, která stávající
    // stav vynechává.
    const assignsWithoutMerge =
      /const (?:redirectUris|webOrigins) = Array\.from\(new Set\(\[\s*\.\.\.(?!currentUris|currentOrigins)/.test(
        SRC,
      );
    expect(
      assignsWithoutMerge,
      "zapisované pole se skládá bez stávajícího stavu — provozní konfigurace by zmizela",
    ).toBe(false);
  });

  test("warmup základu nezávisí na databázi", () => {
    // Hranice, kterou drží celý návrh: repo warmupuje ZÁKLAD, administrace
    // vlastní zbytek. Sync běží při deploji, kdy DB nemusí být dostupná — takže
    // se na ni nesmí vázat vůbec.
    //
    // Měří se POUŽITÍ, ne zmínka: komentář, který vysvětluje, proč se runtime
    // tabulka nečte, je v pořádku (a žádoucí). První verze téhle brány padala
    // právě na vlastním vysvětlujícím komentáři — měřila tvar, ne vadu.
    const code = SRC
      .replace(/\/\*[\s\S]*?\*\//g, "") // blokové komentáře
      .replace(/^\s*\/\/.*$/gm, "") // řádkové komentáře
      .replace(/^\s*\*.*$/gm, ""); // pokračování jsdoc bloku
    const dbUsage = [
      /\bfrom\s+['"]pg['"]/i,
      /\brequire\(\s*['"]pg['"]\s*\)/i,
      /\bpostgres(?:ql)?:\/\//i,
      /\bSELECT\s+.+\s+FROM\s+/i,
      /branding_hostname_mapping/,
    ].filter((re) => re.test(code));
    expect(
      dbUsage.map(String),
      "sync sahá na databázi — běhový zdroj nepatří do warmupu deklarovaného základu",
    ).toEqual([]);
  });
});
