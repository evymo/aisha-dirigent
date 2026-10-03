/**
 * Obsluha žebříčku ke dveřím — měří POŘADÍ ÚKONŮ, ne tabulku.
 *
 * Tabulku (`dalsiKrokDveri`) měří `dvereEskalace.test.ts` a měřila ji devatenáct
 * dní, zatímco ji v produkci nikdo nevolal. Tenhle soubor proto měří to druhé:
 * že se podle ní SKUTEČNĚ jedná — kolikrát se ťuklo, čím, a co se stane, když
 * je průkaz rozbitý.
 *
 * ⭐ Nejdůležitější tvrzení tady není „zaťuká, když má průkaz", ale dvě
 * NEGATIVNÍ: bez průkazu se neťuká vůbec a s průkazem se neťuká dvakrát.
 * První chrání zákon „ťuká vždy jen člověk", druhé chrání dveře před vlastní
 * appkou (cooldown 300 s po 10 pokusech v minutě).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, jest } from "@jest/globals";
import { pametPokusu, zkusDvere, type ObsluhaDveriDeps } from "../lib/obsluhaDveri";
import type { PovereniZarizeni } from "../lib/poverovani-zarizeni";

const PRUKAZ: PovereniZarizeni = {
  kid: "dev-0123456789abcdef",
  // ⛔ ŽÁDNÉ PEM HLAVIČKY V ATRAPÁCH. `-----BEGIN PRIVATE KEY-----` chytá
  // pravidlo `private-key` ve skeneru tajemství (naměřeno 2026-09-10, CI
  // gitleaks 8.18.4) — a správná odpověď NENÍ přidat výjimku, protože ta by
  // zůstala otevřená i pro příští OPRAVDOVÝ klíč. Test potřebuje jen
  // neprůhlednou hodnotu, která nesmí uniknout; k tomu značka stačí.
  privateKeyPem: "SOUKROMY-KLIC-NESMI-VEN",
  publicKeyHex: `04${"ab".repeat(32)}`,
  scope: "ops",
};

function deps(o: Partial<ObsluhaDveriDeps> & { prukaz?: PovereniZarizeni | null } = {}) {
  const zatukejZarizenim = jest.fn(async (p: PovereniZarizeni) => ({ sent: true, kid: p.kid }));
  return {
    nactiPovereni: jest.fn(async () => ("prukaz" in o ? o.prukaz! : PRUKAZ)),
    zatukejZarizenim,
    pamet: pametPokusu(),
    ...o,
  } as ObsluhaDveriDeps & { zatukejZarizenim: typeof zatukejZarizenim };
}

describe("obsluha dveří", () => {
  it("dosažitelné: nic se nedělá a paměť pokusu se čistí", async () => {
    const d = deps();
    d.pamet.oznacZatukano();

    expect(await zkusDvere(true, d)).toEqual({ krok: "pokracuj" });
    expect(d.zatukejZarizenim).not.toHaveBeenCalled();
    // Vyčištěno: až se to příště rozbije, je to NOVÝ výpadek a smí se zaťukat.
    expect(d.pamet.uzZatukano()).toBe(false);
  });

  it("bez průkazu se NEŤUKÁ vůbec — rovnou člověk", async () => {
    const d = deps({ prukaz: null });

    expect(await zkusDvere(false, d)).toMatchObject({ krok: "nabidni-rucni", duvod: "bez-povereni" });
    expect(d.zatukejZarizenim).not.toHaveBeenCalled();
  });

  it("s průkazem zaťuká sám a řekne „zkus znovu“ — ne „otevřeno“", async () => {
    const d = deps();

    const r = await zkusDvere(false, d);

    expect(r).toEqual({ krok: "zkus-znovu", kid: PRUKAZ.kid });
    expect(d.zatukejZarizenim).toHaveBeenCalledTimes(1);
    expect(d.zatukejZarizenim).toHaveBeenCalledWith(PRUKAZ);
  });

  it("⛔ dvě selhání za sebou = JEDNO zaťukání, pak člověk", async () => {
    const d = deps();

    await zkusDvere(false, d);
    const druhe = await zkusDvere(false, d);

    expect(d.zatukejZarizenim).toHaveBeenCalledTimes(1);
    expect(druhe).toMatchObject({ krok: "nabidni-rucni", duvod: "automatika-neprosla" });
  });

  it("po úspěchu je další výpadek NOVÝ pokus a smí se zaťukat znovu", async () => {
    const d = deps();

    await zkusDvere(false, d);
    await zkusDvere(true, d); // prošlo — třeba proto, že správce zařízení schválil
    await zkusDvere(false, d);

    expect(d.zatukejZarizenim).toHaveBeenCalledTimes(2);
  });

  it("neodeslaný datagram je JINÝ stav než mlčící dveře a nese diagnostiku", async () => {
    const d = deps({
      zatukejZarizenim: jest.fn(async () => ({ sent: false, kid: PRUKAZ.kid, error: "letadlový režim" })),
    });

    expect(await zkusDvere(false, d)).toEqual({
      krok: "nabidni-rucni", duvod: "automatika-neprosla", diagnostika: "letadlový režim",
    });
  });

  it("rozbitý průkaz NEDĚLÁ z telefonu cihlu — pošle člověka a nezamlčí proč", async () => {
    const d = deps({
      nactiPovereni: jest.fn(async () => { throw new Error("uložené pověření je neúplné"); }),
    });

    const r = await zkusDvere(false, d);

    expect(r).toMatchObject({ krok: "nabidni-rucni", duvod: "bez-povereni" });
    expect((r as { diagnostika?: string }).diagnostika).toContain("neúplné");
    expect(d.zatukejZarizenim).not.toHaveBeenCalled();
  });

  it("značka „zaťukáno“ se zvedá PŘED odesláním — souběh neproklouzne dvakrát", async () => {
    let pusteno!: () => void;
    const ceka = new Promise<void>((r) => { pusteno = r; });
    const d = deps({
      zatukejZarizenim: jest.fn(async () => { await ceka; return { sent: true, kid: PRUKAZ.kid }; }),
    });

    const prvni = zkusDvere(false, d);
    const druhe = await zkusDvere(false, d); // proběhne, dokud první ještě ťuká
    pusteno();
    await prvni;

    expect(d.zatukejZarizenim).toHaveBeenCalledTimes(1);
    expect(druhe).toMatchObject({ krok: "nabidni-rucni" });
  });

  it("⛔ automatika si NESMÍ umět vyrobit vlastní vstupenku", () => {
    // Vlastnost, ne vzorek: `povereniZarizeni()` průkaz ZAKLÁDÁ, `nactiPovereni()`
    // ho jen čte. Kdyby na automatické cestě ležela ta zakládající, měl by průkaz
    // každý telefon při prvním selhání a podmínka „důvěryhodné zařízení" by
    // neznamenala nic.
    //
    // ⛔ MĚŘÍ SE JEN DOVOZ, NE CELÝ TEXT. První verze téhle brány hledala
    // `povereniZarizeni(` v celém souboru a spadla na vlastním komentáři, který
    // to jméno vysvětluje. Prozaický výskyt nic nevykoná; vykonat to jde jedině
    // přes dovezenou vazbu, a ta je jednoznačná.
    const dovoz = (cesta: string[]): string =>
      (readFileSync(join(__dirname, "..", ...cesta), "utf8")
        .match(/^import[\s\S]*?from\s+["'][^"']+["'];/gm) ?? []).join("\n");

    // Obě strany AUTOMATICKÉ cesty: pravidlo i jeho sestavení pro telefon.
    // `knock-native.ts` se schválně NEMĚŘÍ — tam zakládající funkce bydlet SMÍ,
    // protože obsluhuje zavedení zařízení člověkem. Přesně proto je automatické
    // sestavení ve vlastním souboru: hranice se dá vyslovit jen tak, že jde
    // změřit (viz hlavička `obsluhaDveri-native.ts`).
    for (const soubor of [["lib", "obsluhaDveri.ts"], ["lib", "obsluhaDveri-native.ts"]]) {
      expect(dovoz(soubor)).not.toMatch(/\bpovereniZarizeni\b/);
    }
    expect(dovoz(["lib", "obsluhaDveri-native.ts"])).toMatch(/\bnactiPovereni\b/);
  });

  it("⛔ žebříček MÁ konzumenta v produkci — jinak je to jen hezky otestované ticho", () => {
    // ⛔ TOHLE JE BRÁNA PROTI TŘÍDĚ, NE PROTI JEDNOMU PŘÍPADU. `dvereEskalace.ts`
    // bylo devatenáct dní napsané, otestované a NIKÝM NEVOLANÉ; brány svítily
    // zeleně, protože měřily pravidlo, ne jeho zapojení. Zelená u pravidla
    // neříká nic o tom, že se podle něj někdy jedná.
    //
    // ⭐ Univerzum se ODVOZUJE (obrazovky a komponenty), aby brána nezetlela
    // první novou obrazovkou. Ručně psaný seznam by měřil minulost.
    const koren = join(__dirname, "..");
    const zdroje: string[] = [];
    const projdi = (d: string): void => {
      for (const p of readdirSync(d, { withFileTypes: true })) {
        if (p.isDirectory()) projdi(join(d, p.name));
        else if (/\.tsx?$/.test(p.name)) zdroje.push(join(d, p.name));
      }
    };
    projdi(join(koren, "app"));
    projdi(join(koren, "components"));

    const volajici = zdroje.filter((f) => /\bzkusDvere\s*\(/.test(readFileSync(f, "utf8")));

    const chybi = volajici.length > 0
      ? []
      : ["Žebříček ke dveřím (`zkusDvere` → `dalsiKrokDveri`) nikdo v `app/` ani " +
         "`components/` nevolá. Automatické zaťukání zařízením se tedy NEDĚJE, " +
         "i když je celé napsané a otestované."];
    expect(chybi).toEqual([]);

    // A druhá půlka cesty: obsluha musí opravdu jednat podle PRAVIDLA, ne si
    // pořadí kroků vymyslet znovu vedle něj.
    expect(readFileSync(join(koren, "lib", "obsluhaDveri.ts"), "utf8")).toMatch(/dalsiKrokDveri\s*\(/);
  });

  it("⛔ zařízení ťuká scopem ze SVÉHO průkazu, ne z konfigurace sestavení", () => {
    // ⛔ NAMĚŘENO 2026-09-09. Ověřovatel porovnává `frame.scope` se `scopes`
    // V ROSTERU a při neshodě vrací `scope-denied` — což se ven NEHLÁSÍ, protože
    // dveře mlčí vždycky. Kdyby se scope bral z `resolveKnockTarget()`, mohla by
    // ho aktualizace appky změnit pod schváleným zařízením a to by přestalo
    // fungovat ZPŮSOBEM K NEROZEZNÁNÍ od zavřených dveří.
    //
    // Nativní sestavení jest nelinkuje (C++), takže se měří jeho ZDROJ — týž
    // důvod jako u brány o dovozu výš.
    const zdroj = readFileSync(join(__dirname, "..", "lib", "obsluhaDveri-native.ts"), "utf8");
    const volani = zdroj.slice(zdroj.indexOf("knockAsDevice("));

    expect(volani).toMatch(/scope:\s*p\.scope/);
    expect(volani).not.toMatch(/scope:\s*target\.scope/);
  });
});
