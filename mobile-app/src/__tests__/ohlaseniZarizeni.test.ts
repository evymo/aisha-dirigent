/**
 * Ohlášení průkazu zařízení — a hlídka, aby obě strany zůstaly v kroku.
 *
 * ⛔ POŘADÍ JE TU DANÉ ZVENČÍ, NE ROZHODNUTÍM. `src/types/database.ts` se
 * generuje Z NASAZENÉ DATABÁZE, takže `register_knock_device` v něm bude až po
 * nasazení migrace. Dokud tam není, volání z appky NEPROJDE typovou kontrolou —
 * a obejít to castem by znamenalo zavést do repa první místo, kde typy lžou.
 *
 * ⛔ NEBEZPEČÍ TOHO ČEKÁNÍ je, že se na druhou půlku zapomene a zůstane RPC bez
 * volajícího — přesně ta třída, kterou tenhle den odhalil žebříček ke dveřím
 * (pravidlo s testy a bez konzumenta, brány mlčí). Proto se tu neměří jeden
 * stav, ale SOULAD obou stran: jakmile typy dorazí, brána zčervená a bude
 * červená, dokud appka volat nezačne.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, jest } from "@jest/globals";
import { ohlasZarizeni, type OhlaseniVstup, type OhlaseniZarizeniDeps } from "../lib/ohlaseniZarizeni";
import type { PovereniZarizeni } from "../lib/poverovani-zarizeni";

const PRUKAZ: PovereniZarizeni = {
  kid: "dev-16b5e71e4f33917d",
  // ⛔ ŽÁDNÉ PEM HLAVIČKY V ATRAPÁCH. `-----BEGIN PRIVATE KEY-----` chytá
  // pravidlo `private-key` ve skeneru tajemství (naměřeno 2026-09-10, CI
  // gitleaks 8.18.4) — a správná odpověď NENÍ přidat výjimku, protože ta by
  // zůstala otevřená i pro příští OPRAVDOVÝ klíč. Test potřebuje jen
  // neprůhlednou hodnotu, která nesmí uniknout; k tomu značka stačí.
  privateKeyPem: "SOUKROMY-KLIC-NESMI-VEN",
  publicKeyHex: `04${"ab".repeat(32)}`,
  scope: "ops",
};

function deps(o: Partial<OhlaseniZarizeniDeps> = {}) {
  // Parametr se deklaruje, aby `mock.calls` neslo o prázdné n-tici — jinak
  // by kontrola „co se odesílá" byla castem, tedy tvrzením bez opory.
  const ohlas = jest.fn(async (_v: OhlaseniVstup): Promise<void> => {});
  return {
    nactiPovereni: jest.fn(async () => PRUKAZ as PovereniZarizeni | null),
    ohlas,
    ...o,
  } as OhlaseniZarizeniDeps & { ohlas: typeof ohlas };
}

describe("ohlášení průkazu", () => {
  it("pošle otisk, scope i most na push", async () => {
    const d = deps();

    expect(await ohlasZarizeni("push-1", d)).toEqual({ stav: "ohlaseno", kid: PRUKAZ.kid });
    expect(d.ohlas).toHaveBeenCalledWith({
      kid: PRUKAZ.kid, publicKeyHex: PRUKAZ.publicKeyHex, scope: PRUKAZ.scope, pushDeviceId: "push-1",
    });
  });

  it("⛔ SOUKROMÝ KLÍČ SE NEODESÍLÁ — ani omylem", async () => {
    const d = deps();
    await ohlasZarizeni("push-1", d);

    const [odeslano] = d.ohlas.mock.calls[0];
    expect(Object.keys(odeslano as object).sort()).toEqual(["kid", "publicKeyHex", "pushDeviceId", "scope"]);
    expect(JSON.stringify(odeslano)).not.toContain("PRIVATE KEY");
  });

  it("bez průkazu se NEOHLAŠUJE nic — a není to chyba", async () => {
    const d = deps({ nactiPovereni: jest.fn(async () => null) });

    expect(await ohlasZarizeni("push-1", d)).toEqual({ stav: "neni-co" });
    expect(d.ohlas).not.toHaveBeenCalled();
  });

  it("most smí chybět — schvalovat jde i bez push id", async () => {
    const d = deps();
    await ohlasZarizeni(null, d);

    expect(d.ohlas).toHaveBeenCalledWith(expect.objectContaining({ pushDeviceId: null }));
  });

  it("⛔ neúspěch se VYSLOVÍ, nespolkne — ticho vypadá jako „neschválili mě“", async () => {
    const dRpc = deps({ ohlas: jest.fn(async (_v: OhlaseniVstup): Promise<void> => { throw new Error("síť"); }) });
    expect(await ohlasZarizeni("p", dRpc)).toEqual({ stav: "selhalo", duvod: "síť" });

    const dPrukaz = deps({ nactiPovereni: jest.fn(async () => { throw new Error("neúplné"); }) });
    expect(await ohlasZarizeni("p", dPrukaz)).toEqual({ stav: "selhalo", duvod: "neúplné" });
  });
});

describe("obě strany musí zůstat v kroku", () => {
  const KOREN = join(__dirname, "..");
  const RPC = "register_knock_device";

  const vTypech = (): boolean =>
    readFileSync(join(KOREN, "types", "database.ts"), "utf8").includes(RPC);

  function volajici(): string[] {
    const out: string[] = [];
    const projdi = (d: string): void => {
      for (const p of readdirSync(d, { withFileTypes: true })) {
        if (p.isDirectory() && p.name !== "__tests__" && p.name !== "types") projdi(join(d, p.name));
        // ⛔ MĚŘÍ SE VOLÁNÍ, NE ZMÍNKA. První verze hledala jméno kdekoli
        // v textu a spadla na vlastním komentáři, který to RPC vysvětluje —
        // táž past jako u brány o dovozu v `obsluhaDveri.test.ts`. Zavolat ho
        // jde jedině řetězcovým literálem, a ten je jednoznačný.
        else if (/\.tsx?$/.test(p.name) &&
                 new RegExp(`["']${RPC}["']`).test(readFileSync(join(d, p.name), "utf8")))
          out.push(join(d, p.name));
      }
    };
    projdi(KOREN);
    return out;
  }

  /**
   * ⚠️ AŽ SE BUDE ZAPOJOVAT, KLÍČE MUSÍ JÍT ABECEDNĚ:
   *
   *     p_kid, p_public_key_hex, p_push_device_id, p_scope
   *
   * Generované typy řadí parametry abecedně a `rpc-params-alphabetical`
   * to vymáhá — jiné pořadí skončí jako „function not found" (96+ chyb
   * v Sentry na iOS, viz hlavička té brány). Naměřeno 2026-09-09: první
   * verze zapojení měla `p_scope` před `p_push_device_id` a spadla by.
   *
   * ⛔ POŘADÍ V SQL DEFINICI ABECEDNÍ BÝT NEMUSÍ a schválně se nesjednocuje:
   * `register_mobile_session` ho abecední nemá a v produkci chodí — PostgREST
   * páruje JMÉNEM. Vymyslet si tu přísnější pravidlo by znamenalo označit
   * 1665 funkcí za vadné kvůli vlastnosti, kterou nikdo nepotřebuje.
   */
  it("⛔ jakmile je RPC v typech, MUSÍ mít v appce volajícího", () => {
    const chybi = !vTypech() || volajici().length > 0
      ? []
      : [`\`${RPC}\` je v \`types/database.ts\`, ale nikdo ho v appce nevolá. ` +
         "Průkaz zařízení se tedy nikdy neohlásí, v administraci nebude co schválit " +
         "a automatické ťukání nezačne fungovat — bez jediné červené brány."];
    expect(chybi).toEqual([]);
  });

  it("dokud v typech NENÍ, appka ho volat nesmí (neprošlo by tsc)", () => {
    // ⛔ Druhý směr téhož souladu. Bez něj by šlo „vyřešit" bránu výš castem
    // a typy by od té chvíle lhaly — první takové místo v repu.
    const chybi = vTypech() || volajici().length === 0
      ? []
      : [`\`${RPC}\` v typech NENÍ, ale appka ho volá: ${volajici().join(", ")}. ` +
         "Buď chybí regenerace typů (`db:types:gen:local`), nebo někdo obešel typovou kontrolu."];
    expect(chybi).toEqual([]);
  });
});
