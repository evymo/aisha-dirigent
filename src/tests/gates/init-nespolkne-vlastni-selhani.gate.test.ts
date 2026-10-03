import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Init, který má JEDNU práci, ji nesmí odmítnout udělat a skončit nulou.
 *
 * ⛔ NAMĚŘENO 2026-09-07 v RIQ. V n8n bylo NULA workflowů, ačkoli repo jich nese
 * 93 (36 s časovým spouštěčem) a `n8n-workflow-init` je v nasazovací dráze.
 * Bootstrap API klíče padal na `404 Cannot POST /rest/owner/setup` (n8n 1.79.0
 * tu routu po dokončeném setupu ODSTRANÍ) a entrypoint to spolkl:
 *
 *     log "api-key bootstrap FAILED — skipping workflow deploy … Exiting 0
 *          so the n8n stack stays healthy."
 *     exit 0
 *
 * ⭐ TO ODŮVODNĚNÍ BYLO NEPRAVDIVÉ — a je to změřené. `plugin-publish-init`
 * v témže clusteru končil kódem 1 dvanáct dní a appka `<fork>-core` u toho svítila
 * `running:healthy`. Init s `restart: "no"` a vypnutým healthcheckem stack
 * neshodí ani nenulovým koncem, takže `exit 0` nic nechránil — jen schoval, že
 * se nedoručil ani jeden workflow. Cena za tu „ochranu" byla, že si toho nikdo
 * dvanáct dní nevšiml.
 *
 * ⭐ MĚŘÍ SE VLASTNOST: skript nesmí mít větev, která po SELHÁNÍ bootstrapu
 * končí nulou. Netvrdí se, jak se hlášky jmenují ani jaký je návratový kód —
 * tvrdí se, že selhání není zaměnitelné s úspěchem.
 */
const ROOT = join(__dirname, "../../..");
const ENTRYPOINT = join(ROOT, "scripts/n8n-deploy-entrypoint.sh");
const BOOTSTRAP = join(ROOT, "scripts/n8n-bootstrap-apikey.mjs");

describe("init nespolkne vlastní selhání", () => {
  const src = readFileSync(ENTRYPOINT, "utf8");

  it("měřidlo má co měřit — entrypoint bootstrap skutečně volá", () => {
    expect(src, "entrypoint nevolá `n8n-bootstrap-apikey.mjs`").toMatch(
      /n8n-bootstrap-apikey\.mjs/,
    );
  });

  it("selhání bootstrapu nekončí nulou", () => {
    // ⛔ KOTVIT NA KÓD, NE NA ZMÍNKU. První výskyt jména skriptu je v HLAVIČCE
    // souboru, takže slice od něj měřil úplně jiný úsek a mutace `exit 1` →
    // `exit 0` bránou prošla. Chyceno vlastním mutačním testem 2026-09-07.
    const volani = /^if\s+node\s+.*n8n-bootstrap-apikey\.mjs.*$/m.exec(src);
    expect(volani, "nenalezeno spuštění bootstrapu (`if node … n8n-bootstrap-apikey.mjs`)").not.toBeNull();
    const i = volani!.index;
    const konec = src.indexOf("\nfi", i);
    // ⛔ KOMENTÁŘE PRYČ PŘED MĚŘENÍM. Vysvětlující text v té větvi cituje
    // `exit 0` jako popis staré vady — bez odfiltrování by brána červenala nad
    // správným kódem (chyceno 2026-09-07 při psaní téhle brány).
    const vetevSelhani = src
      .slice(src.indexOf("\nelse", i), konec)
      .replace(/^\s*#.*$/gm, "");
    expect(
      vetevSelhani,
      "Větev pro SELHANÝ bootstrap končí `exit 0`. Tím se selhání stane\n" +
        "nerozeznatelné od úspěchu: workflowy se nedoručí a nasazení mlčí.\n" +
        "Naměřeno 2026-09-07 — n8n mělo 0 workflowů z 93 a nikdo o tom nevěděl.",
    ).not.toMatch(/exit\s+0/);
  });

  it("chybějící klíč taky nekončí nulou — bez klíče se workflowy nedoručí", () => {
    const i = src.indexOf("KEY_OUT\" ]");
    const usek = src.slice(i, i + 260).replace(/^\s*#.*$/gm, "");
    expect(
      usek,
      "Prázdný soubor s klíčem znamená, že deploy workflowů NEPROBĚHNE.\n" +
        "Konec nulou z toho dělá úspěch.",
    ).not.toMatch(/exit\s+0/);
  });

  it("bootstrap zná i 404, nejen 400 — n8n routu po setupu odstraní", () => {
    // Naměřeno na n8n 1.79.0: `404 Cannot POST /rest/owner/setup`.
    const boot = readFileSync(BOOTSTRAP, "utf8");
    // Kotvíme na PODMÍNKU, ne na řetězec `owner/setup` — ten je i v hlavičce
    // a slice od něj měřil komentář místo kódu (chyceno vlastní branou).
    const stavy = [...boot.matchAll(/setup\.status\s*===\s*(\d{3})/g)].map((m) => m[1]);
    expect(
      stavy,
      "Bootstrap kontroluje jen HTTP 400. n8n ≥1.7x po dokončeném setupu tu\n" +
        "routu odstraní a odpoví 404 — ten pak spadne do FATAL.",
    ).toEqual(expect.arrayContaining(["400", "404"]));
  });
});

describe("deploy workflowů neposílá cizí klíče a nemlčí o selhání", () => {
  const DEPLOY = join(ROOT, "scripts/deploy-workflows.mjs");
  const ENTRY = readFileSync(ENTRYPOINT, "utf8").replace(/^\s*#.*$/gm, "");
  const deploy = readFileSync(DEPLOY, "utf8");

  it("settings se filtrují na klíče, které API zná", () => {
    // ⛔ NAMĚŘENO 2026-09-07: z 93 workflowů jich 66 skončilo na
    // `settings must NOT have additional properties` — a přesně 66 souborů nese
    // `callerPolicy`. Posílat `local.settings` celé znamená posílat i klíče,
    // které veřejné API n8n nezná.
    expect(
      deploy,
      "`local.settings` jde na drát bez filtru — API odmítne každý workflow,\n" +
        "který nese editorový klíč (`callerPolicy`, `availableInMCP`).",
    ).not.toMatch(/settings:\s*local\.settings/);
  });

  it("neúspěšný deploy končí nenulově", () => {
    // ⛔ KOTVIT NA PODMÍNKU, NE NA OKNO. Okno 400 znaků od hlášky dosáhlo až na
    // `process.exit(1)` v závěrečném `catch`, takže mutace (odebrání konce)
    // bránou prošla. Chyceno vlastním mutačním testem 2026-09-07.
    expect(
      deploy,
      "Po hlášce o selhání chybí nenulový konec. Skript pak vrátí 0 a entrypoint\n" +
        "zaloguje `workflow deploy ok` — přesně stav z 2026-09-07, kdy se nenahrálo\n" +
        "66 z 93 workflowů a nasazení hlásilo úspěch.",
    ).toMatch(/results\.failed\s*>\s*0[\s\S]{0,120}?process\.exit\(1\)/);
  });

  it("entrypoint nekončí natvrdo nulou — propaguje výsledek deploye", () => {
    const posledni = ENTRY.trimEnd().split("\n").pop() ?? "";
    expect(
      posledni,
      "Poslední řádek entrypointu je `exit 0`, takže i neúspěšný deploy vypadá\n" +
        "jako úspěch. Má se propagovat návratový kód deploye.",
    ).not.toMatch(/^\s*exit\s+0\s*$/);
  });
});
