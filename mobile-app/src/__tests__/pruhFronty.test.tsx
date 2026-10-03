/**
 * Pruh fronty — co je vidět a kdy se mlčí.
 *
 * ⛔ Rozhodovací tabulka má vlastní důkaz (`stavFronty.test.ts`). Tady se měří
 * jen to, co je vlastností KRESLENÍ: že se mlčení opravdu projeví ničím, že se
 * počet dostane do textu, a že se nenabízí tlačítko, které nemůže nic změnit.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react-native";
import { PruhFronty } from "@/components/PruhFronty";

const KLID = {
  queueSize: 0, needsAttention: 0,
  isProcessing: false, isConnected: true, storeUnreadable: false,
};

describe("mlčení", () => {
  it("⛔ prázdná fronta nekreslí NIC", () => {
    const { queryByTestId } = render(<PruhFronty {...KLID} />);
    expect(queryByTestId("pruh-fronty")).toBeNull();
  });
});

describe("co je vidět", () => {
  it("počet čekajících je v textu", () => {
    const { getByTestId } = render(<PruhFronty {...KLID} queueSize={3} isConnected={false} />);
    expect(getByTestId("pruh-fronty-text").props.children).toMatch(/3/);
  });

  it("⛔ nečitelné úložiště NEUKAZUJE nulu", () => {
    const { getByTestId } = render(<PruhFronty {...KLID} storeUnreadable />);
    expect(getByTestId("pruh-fronty-text").props.children).not.toMatch(/\d/);
  });
});

describe("ruční pokus", () => {
  it("⛔ se NENABÍZÍ bez signálu — tlačítko, co nic neudělá, kazí důvěru i těm ostatním", () => {
    const { queryByTestId } = render(
      <PruhFronty {...KLID} queueSize={2} isConnected={false} onZkusit={() => {}} />);
    expect(queryByTestId("pruh-fronty-zkusit")).toBeNull();
  });

  it("⛔ se NENABÍZÍ během odesílání — druhý běh by jen soupeřil s prvním", () => {
    const { queryByTestId } = render(
      <PruhFronty {...KLID} queueSize={2} isProcessing onZkusit={() => {}} />);
    expect(queryByTestId("pruh-fronty-zkusit")).toBeNull();
  });

  it("nabízí se tam, kde může něco změnit", () => {
    const { getByTestId } = render(
      <PruhFronty {...KLID} queueSize={2} needsAttention={2} onZkusit={() => {}} />);
    expect(getByTestId("pruh-fronty-zkusit")).toBeTruthy();
  });

  it("bez obsluhy se nekreslí vůbec", () => {
    const { queryByTestId } = render(<PruhFronty {...KLID} queueSize={2} />);
    expect(queryByTestId("pruh-fronty-zkusit")).toBeNull();
  });
});

/**
 * Pruh se musí NĚKDE KRESLIT — jinak je to hezky otestované ticho.
 *
 * ⛔ NAMĚŘENO 2026-09-09. Testy výš mountují komponentu SAMOSTATNĚ, takže by
 * všechny zůstaly zelené i ve chvíli, kdy `<PruhFronty>` z obrazovky zmizí.
 * Řidič by přišel o jedinou odpověď na otázku „odešlo mi to?" a nic by
 * nezakřičelo. Je to táž třída, kterou týž den odhalil žebříček ke dveřím:
 * pravidlo má domov i konzumenta, ale mezi nimi nemusí vést cesta — a měřidlo,
 * které měří jen jeden konec, o tom mlčí.
 *
 * ⭐ Univerzum se ODVOZUJE ze stromu obrazovek, ne vypisuje. Ručně psaný seznam
 * by zetlel první novou obrazovkou a bránu by to tiše vyprázdnilo.
 */
describe("pruh má konzumenta na obrazovce", () => {
  const KOREN = join(__dirname, "..");

  function zdrojeObrazovek(): string[] {
    const out: string[] = [];
    const projdi = (d: string): void => {
      for (const p of readdirSync(d, { withFileTypes: true })) {
        if (p.isDirectory()) projdi(join(d, p.name));
        else if (p.name.endsWith(".tsx")) out.push(join(d, p.name));
      }
    };
    projdi(join(KOREN, "app"));
    return out;
  }

  const vykreslujici = () =>
    zdrojeObrazovek().filter((f) => /<PruhFronty[\s/>]/.test(readFileSync(f, "utf8")));

  it("⛔ nějaká obrazovka pruh opravdu vykresluje", () => {
    const chybi = vykreslujici().length > 0
      ? []
      : ["`<PruhFronty>` nekreslí žádná obrazovka v `app/`. Rozhodovací tabulka " +
         "`stavFronty` i komponenta jsou testované, ale k řidiči se nedostanou."];
    expect(chybi).toEqual([]);
  });

  it("⛔ dostane CELÝ vstup — chybějící pole tiše vypne větev", () => {
    // `stavFronty` rozhoduje z pěti údajů. Kdyby se jeden nepředal, byl by
    // `undefined` a příslušná větev by se NIKDY nerozsvítila — nejcitlivější je
    // `needsAttention`, protože právě on nese „samo se to neodešle". Chyba by
    // se přitom neprojevila pádem ani červeným testem, jen tichem.
    const POVINNE = ["queueSize", "needsAttention", "isProcessing", "isConnected", "storeUnreadable"];

    const chybi: string[] = [];
    for (const soubor of vykreslujici()) {
      const zdroj = readFileSync(soubor, "utf8");
      const zac = zdroj.indexOf("<PruhFronty");
      const volani = zdroj.slice(zac, zdroj.indexOf("/>", zac));
      for (const pole of POVINNE) {
        if (!new RegExp(`\\b${pole}\\s*=`).test(volani))
          chybi.push(`${soubor.slice(KOREN.length + 1)}: <PruhFronty> nedostává \`${pole}\``);
      }
    }
    expect(chybi).toEqual([]);
  });
});
