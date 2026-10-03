/**
 * Brána: parser odpovědi na `/api/v1/deploy` musí zvládnout SKUTEČNÝ tvar.
 *
 * PROČ (naměřeno 2026-08-10 živým voláním na nasazované appce)
 * -----------------------------------------------------
 * Coolify na `POST /api/v1/deploy?uuid=…&force=true` vrací:
 *
 *   {"deployments":[{"message":"Application <app> deployment queued.",
 *                    "resource_uuid":"<app-uuid>","deployment_uuid":"<deploy-uuid>"}]}
 *
 * Kořenový `deployment_uuid` NEEXISTUJE. `deploy-and-verify.sh` ho ale četl jen
 * z kořene, dostal prázdno a skončil hláškou „nasazení se nezařadilo" —
 * přestože Coolify nasazení poctivě zařadil.
 *
 * ⭐ CO JE NA TOM PODSTATNÉ: ta chyba vznikla V OPRAVĚ vady opačného směru.
 * Krok předtím hlásil HOTOVO nad nasazením, které se nikdy nezaložilo; oprava
 * (#177) správně začala vyžadovat důkaz — jenže ho četla ze špatného místa,
 * takže „tiše zeleno" překlopila na „vždy červeno".
 *
 * `Deploy: Core`, `Deploy: Edge` i `Deploy: Extranet` tak padaly na mainu ČTYŘI
 * merge po sobě (#177 → #181), aniž si toho kdokoli všiml — na PR se deploy
 * PŘESKAKUJE, takže první běh nad mainem je zároveň první test a ten už nic
 * neblokuje. Zaměnit tiché zeleno za trvalé červeno NENÍ oprava.
 *
 * CO SE MĚŘÍ
 * ----------
 * Ne výskyt řetězce `deployments` ve skriptu — to by prošlo i komentáři
 * (viz [[brana-nesmi-merit-text-ale-cin]], táž past dvakrát za večer).
 * Brána parser ze skriptu VYŘÍZNE, SPUSTÍ nad fixturami a porovná výstup.
 * Když ho někdo přepíše zpět na kořenové čtení, tvrzení padne — protože
 * fixtura kořenové pole nemá.
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SKRIPT = join(process.cwd(), "scripts/ci/deploy-and-verify.sh");

/** Vyřízne tělo `node -e '…'`, kterým skript čte uuid nasazení. */
function parserZeSkriptu(): string {
  const t = readFileSync(SKRIPT, "utf8");
  const m = t.match(/NASAZENI=\$\(node -e '([\s\S]*?)'\s*"\$ODPOVED"\)/);
  expect(
    m,
    "v deploy-and-verify.sh se nenašel blok `NASAZENI=$(node -e '…' \"$ODPOVED\")` — " +
      "buď se přejmenoval, nebo se uuid čte jinak. Brána ztratila předmět měření; " +
      "oprav ji, NEODSTRAŇUJ ji.",
  ).not.toBeNull();
  return m![1];
}

/** Spustí vyříznutý parser nad daným tělem odpovědi a vrátí, co vypsal. */
function zparsuj(telo: string): string {
  const dir = mkdtempSync(join(tmpdir(), "deploy-resp-"));
  const soubor = join(dir, "resp.json");
  writeFileSync(soubor, telo);
  return execFileSync(process.execPath, ["-e", parserZeSkriptu(), soubor], {
    encoding: "utf8",
  });
}

// TVAR zaznamenané odpovědi z produkce (2026-08-10). Needitovat podle toho, co je
// zrovna pohodlné — je to POZOROVÁNÍ, ne přání.
//
// ⚠️ Hodnoty jsou ZÁSTUPNÉ. Původně tu stály skutečné identifikátory instance
// (uuid appky i nasazení v Coolify) — v souboru, který je GENERICKOU částí
// platformy a jde do upstreamu. Instance se do open-code stromu nepromítá ani
// fixturou; a pro tvrzení níž je podstatný TVAR, ne čí to bylo nasazení.
const SKUTECNA_ODPOVED = JSON.stringify({
  deployments: [
    {
      message: "Application demo-core deployment queued.",
      resource_uuid: "aaaaaaaaaaaaaaaaaaaaaaaa",
      deployment_uuid: "bbbbbbbbbbbbbbbbbbbbbbbb",
    },
  ],
});

describe("parser odpovědi /api/v1/deploy (brána)", () => {
  test("ze SKUTEČNÉ odpovědi Coolify vytáhne uuid nasazení", () => {
    expect(
      zparsuj(SKUTECNA_ODPOVED),
      "parser nevytáhl `deployments[0].deployment_uuid`. Přesně kvůli tomuhle padaly\n" +
        "Deploy: Core / Edge / Extranet čtyři merge po sobě: skript hlásil\n" +
        "nasazení se nezařadilo nad nasazením, které Coolify poctivě zařadil.",
    ).toBe("bbbbbbbbbbbbbbbbbbbbbbbb");
  });

  test("zvládne i kořenový tvar — kdyby ho Coolify někdy vracel", () => {
    expect(zparsuj(JSON.stringify({ deployment_uuid: "korenove123" }))).toBe("korenove123");
  });

  test("na odpovědi BEZ uuid vrací prázdno — sonda musí umět odpovědět NE", () => {
    expect(zparsuj(JSON.stringify({ message: "nic se nezařadilo" }))).toBe("");
    expect(zparsuj("tohle není JSON")).toBe("");
  });

  test("prázdné pole `deployments` NENÍ důkaz o zařazení", () => {
    expect(
      zparsuj(JSON.stringify({ deployments: [] })),
      "prázdný seznam znamená, že se nic nezařadilo — parser nesmí vrátit nic, co by\n" +
        "krok výš přijal jako uuid k čekání.",
    ).toBe("");
  });
});
