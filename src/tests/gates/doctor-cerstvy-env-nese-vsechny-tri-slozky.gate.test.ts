/**
 * Brána: doctorův „čerstvý env" musí nést VŠECHNY TŘI složky, které slibuje.
 *
 * ⛔ NAMĚŘENO 2026-09-20. Fáze D doctoru si staví dočasný env, aby compose
 * preflight neměřila proti zastaralému `.env.coolify`. Komentář u toho bloku
 * říká, že ho staví „stejně jako Step 2 (topologie + generate-secrets +
 * env-doctor)" — jenže kód spouštěl POUZE `aisha-env-doctor.mjs`.
 *
 * Chyběly proto proměnné, které v reálném běhu existují:
 *     MESH_DNS_{NETWORK,SUBNET,RESOLVER_IP}      ← generate-secrets.mjs
 *     KEYCLOAK_{DOMAIN_PUBLIC,EXTRA_HOST_ALIAS}  ← derive-domains.mjs
 * a doctor hlásil TVRDÝ fail „cold-start by spadl ve Step 2b" u běhu, který by
 * prošel: naměřeno 28 z 34 stacků. Po doplnění obou složek 34/34.
 *
 * ⛔ PROČ NA TOM ZÁLEŽÍ VÍC, NEŽ VYPADÁ: doctor je Step 0 a jeho nenulový kód
 * cold-start ZASTAVÍ. Falešný tvrdý fail tedy nenutí opravit vadu — nutí sáhnout
 * po `--skip-doctor` a vypnout CELÝ preflight kvůli jeho nepravdivé části.
 * Falešný fail je horší než chybějící kontrola: učí lidi kontrolu obcházet.
 *
 * Je to táž třída jako mrtvý doménový overlay: DEKLARACE (tady komentář) tvrdí
 * jedno, kód dělá druhé, a rozdíl se projeví až jako vada úplně jinde.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");
const SRC = readFileSync(join(ROOT, "scripts/cold-start-doctor.sh"), "utf-8");

/** Blok, který staví dočasný env — od `_fresh_env=` po spuštění env-doctoru. */
function freshEnvBlock(): string {
  const start = SRC.indexOf('_fresh_env="$(mktemp');
  expect(start, "blok stavby čerstvého envu nenalezen — přejmenoval se?").toBeGreaterThan(-1);
  const end = SRC.indexOf("aisha-env-doctor.mjs", start);
  expect(end, "spuštění env-doctoru v bloku nenalezeno").toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe("doctorův čerstvý env nese všechny tři složky", () => {
  test("připisuje TOPOLOGII (derive-domains --shell)", () => {
    // ⛔ Nestačí, že se derive-domains v souboru někde VYSKYTNE — doctor ho
    // zmiňuje i v chybových hláškách. Měří se, že běží UVNITŘ stavby envu
    // a že se jeho výstup PŘIPISUJE (>>), ne zahazuje.
    const blok = freshEnvBlock();
    expect(
      blok,
      "čerstvý env nenese topologii — bez ní chybí KEYCLOAK_DOMAIN_PUBLIC " +
        "a KEYCLOAK_EXTRA_HOST_ALIAS a preflight padne na proměnných, které v reálném běhu existují",
    ).toMatch(/derive-domains\.mjs["']?\s+--shell[^\n]*>>/);
  });

  test("připisuje GENERÁTOR TAJEMSTVÍ (generate-secrets.mjs)", () => {
    const blok = freshEnvBlock();
    expect(
      blok,
      "čerstvý env nenese výstup generate-secrets — bez něj chybí MESH_DNS_* " +
        "a hesla, a doctor ohlásí tvrdý fail u běhu, který by prošel",
    ).toMatch(/generate-secrets\.mjs/);
    expect(
      blok,
      "výstup generate-secrets se nepřipisuje do souboru (>>) — mít ho jen v PROSTŘEDÍ nestačí: " +
        "preflight-compose jede `docker compose --env-file` a čte ten SOUBOR (naměřeno: " +
        "doctor s 225 topologickými klíči v env padal dál)",
    ).toMatch(/generate-secrets\.mjs[\s\S]*?>>\s*"\$_fresh_env"/);
  });

  test("pořadí je .env.coolify → topologie → generátor (poslední přebíjí)", () => {
    // U duplicitního klíče bere Compose POSLEDNÍ výskyt, takže pořadí připsání
    // JE pořadí priority. Kdyby se čerstvé složky připsaly PŘED zkopírováním
    // .env.coolify, zastaralý soubor by je přebil a oprava by byla k ničemu —
    // a to tiše, protože by se nic nerozbilo, jen by se měřil starý stav.
    // ⛔ Měří se pozice VOLÁNÍ uvnitř bloku, ne první zmínka v souboru. První
    // verze téhle brány hledala `SRC.indexOf("derive-domains.mjs")` a našla
    // komentář o několik set řádků výš — tedy tvar, ne vadu. Táž chyba, před
    // kterou brána sama varuje v ostatních testech.
    const blok = freshEnvBlock();
    // Hledá se VOLÁNÍ (`node …/skript.mjs`), ne pouhá zmínka: obojí se v tomhle
    // bloku vyskytuje i v komentáři, který vysvětluje, proč tu složky jsou.
    const kopie = blok.indexOf('cp "$DOKTOR_ENV_SOUBOR" "$_fresh_env"');
    const topologie = blok.search(/node\s+"\$REPO_ROOT\/scripts\/lib\/derive-domains\.mjs"/);
    const generator = blok.search(/node\s+"\$REPO_ROOT\/scripts\/generate-secrets\.mjs"/);
    expect(kopie, "kopie .env.coolify do čerstvého envu nenalezena").toBeGreaterThan(-1);
    expect(topologie, "volání derive-domains v bloku nenalezeno").toBeGreaterThan(-1);
    expect(generator, "volání generate-secrets v bloku nenalezeno").toBeGreaterThan(-1);
    expect(
      topologie,
      "topologie se připisuje PŘED kopií .env.coolify — zastaralý soubor by ji přebil",
    ).toBeGreaterThan(kopie);
    expect(
      generator,
      "generátor se připisuje PŘED kopií .env.coolify — zastaralý soubor by ho přebil",
    ).toBeGreaterThan(kopie);
  });

  test("selhání složky doctora nepoloží (|| true), aby doměřil zbytek", () => {
    // Měřidlo se nesmí rozbít o vlastní vstup: když topologie nebo generátor
    // selže, doctor má doměřit, co umí, a chybějící klíče ohlásit jako fail níž.
    const blok = freshEnvBlock();
    const volani = blok.match(/(derive-domains|generate-secrets)\.mjs[\s\S]*?\n/g) ?? [];
    expect(volani.length, "v bloku nejsou obě volání").toBeGreaterThanOrEqual(2);
    expect(
      blok.match(/\|\|\s*true/g)?.length ?? 0,
      "chybí `|| true` u obou složek — selhání jedné by shodilo celý doctor na chybě jeho vlastního měřidla",
    ).toBeGreaterThanOrEqual(2);
  });
});
