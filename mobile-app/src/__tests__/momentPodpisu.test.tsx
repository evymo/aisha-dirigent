/**
 * Moment podpisu — obrazovka, kterou drží PŘEBÍRAJÍCÍ.
 *
 * Měří se dvě věci, které o ní rozhodují:
 *   · vidí, CO přebírá a CO stvrzuje (jinak podepisuje naslepo);
 *   · nevidí, co se ho netýká (odměna řidiče, interní přiřazení).
 *
 * ⭐ Filtr údajů bydlí u VOLAJÍCÍHO (`kroky.tsx` → `udajePro`), ne tady:
 *   komponenta žádný údaj nezná, takže kdyby ho někdo předal, vykreslí ho.
 *   Právě proto se to měří — tvrzení „ASH tam není" je o tom, CO SE PŘEDÁVÁ.
 */
import { render as rtlRender } from "@testing-library/react-native";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";
import { MomentPodpisu } from "@/components/MomentPodpisu";

/**
 * Modál si bezpečnou zónu čte z kontextu — v appce ho poskytuje kořenový
 * layout, v testu ho musíme dodat sami. `initialMetrics` je způsob, který
 * knihovna pro testy předepisuje (bez nich čeká na změření a vyhodí).
 */
const METRIKY: Metrics = {
  frame: { x: 0, y: 0, width: 402, height: 874 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

const render = (ui: React.ReactElement) =>
  rtlRender(<SafeAreaProvider initialMetrics={METRIKY}>{ui}</SafeAreaProvider>);

const UDAJE = [
  { label: "Doklad", value: "DL-2026-0042" },
  { label: "Co", value: "Beton C25/30" },
  { label: "Odběratel", value: "Alfa s.r.o." },
  { label: "Kam", value: null },            // prázdný — nesmí se kreslit
];

const zaklad = {
  visible: true,
  udaje: UDAJE,
  onZrusit: () => {},
  onHotovo: () => {},
};

describe("co přebírající vidí", () => {
  it("údaje o dodávce, podle kterých si ji porovná s realitou", () => {
    const { getByText } = render(<MomentPodpisu {...zaklad} predmet="DL-2026-0042" />);
    expect(getByText("DL-2026-0042")).toBeTruthy();
    expect(getByText("Beton C25/30")).toBeTruthy();
    expect(getByText("Alfa s.r.o.")).toBeTruthy();
  });

  it("⛔ prázdný údaj se NEKRESLÍ — nevyplněný řádek není informace", () => {
    const { queryByText } = render(<MomentPodpisu {...zaklad} />);
    expect(queryByText("Kam")).toBeNull();
  });

  /**
   * ⛔ MĚŘÍ SE VLASTNOST, NE PŘEKLAD. V jestu nikdo nevolá `initLocale`, takže
   * jazyk zůstává `en` — tvrzení nad českou větou by tu selhalo, i kdyby
   * komponenta byla v pořádku. Podstatné je, že se PŘEDMĚT dostane DO VĚTY:
   * v dokladovém řádku je jednou, a když je předmět zadán, objeví se podruhé.
   */
  it("předmět je i ve větě, kterou stvrzuje", () => {
    const { queryAllByText } = render(<MomentPodpisu {...zaklad} predmet="DL-2026-0042" />);
    expect(queryAllByText(/DL-2026-0042/).length).toBeGreaterThanOrEqual(2);

    // Bez předmětu zůstane jen řádek s dokladem — věta ho neobsahuje.
    const bezPredmetu = render(<MomentPodpisu {...zaklad} predmet={null} />);
    expect(bezPredmetu.queryAllByText(/DL-2026-0042/)).toHaveLength(1);
  });

  it("své jméno, je-li známo", () => {
    const { getByTestId } = render(<MomentPodpisu {...zaklad} podepisujici="  Jan Novák  " />);
    expect(getByTestId("moment-podpisu-kdo").props.children).toBe("Jan Novák");
  });
});

describe("co přebírající NEvidí", () => {
  it("⛔ odměnu řidiče ani interní přiřazení — pokud se nepředají", () => {
    const { queryByText } = render(<MomentPodpisu {...zaklad} predmet="DL-2026-0042" />);
    expect(queryByText(/ASH/)).toBeNull();
    expect(queryByText(/production_operator|Přiřazeno|Role/)).toBeNull();
  });
});

describe("hotovo", () => {
  it("⛔ je NEAKTIVNÍ, dokud podpis není — vypnuté je lepší než neúčinné", () => {
    const { getByTestId } = render(<MomentPodpisu {...zaklad} />);
    expect(getByTestId("moment-podpisu-hotovo").props.accessibilityState.disabled).toBe(true);
  });
});

describe("zavřené", () => {
  it("neviditelný moment nekreslí nic", () => {
    const { queryByTestId } = render(<MomentPodpisu {...zaklad} visible={false} />);
    expect(queryByTestId("moment-podpisu")).toBeNull();
  });
});
