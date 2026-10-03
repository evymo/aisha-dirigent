/**
 * Nativní renderer jazyka ESDK — tytéž věty, jiná platforma.
 *
 * Názvy testů nesou id z `@aisha/extranet-sdk-ui` → `JAZYK.json`. Brána
 * `jazyk-parita` ověřuje, že KAŽDÉ pravidlo jazyka doloží OBA renderery —
 * protože mobil ESDK importovat nemůže, paritu nemůže držet sdílený kód
 * a musí ji držet sdílený DŮKAZ.
 */
import { render } from "@testing-library/react-native";
import { Evidence, Fact, jeTazHodnota, Lamp, Measure, Prov } from "@/extranet/esdk";

describe("stav a zdroj", () => {
  it("[JAZYK-01] stav se čte jako glyf + slovo, nikdy jen jako barva", () => {
    const { getByText } = render(<Lamp state="fault" label="porucha" />);
    // Slovo musí být přítomné samo o sobě…
    expect(getByText("porucha")).toBeTruthy();
    // …a glyf vedle něj, aby stav šel přečíst i bez barvy.
    expect(getByText("■")).toBeTruthy();
  });

  it("[JAZYK-01] každý stav má vlastní glyf — dva stavy nesmí vypadat stejně", () => {
    const glyfy = (["ok", "wait", "fault", "plan", "mute"] as const).map((st) => {
      const { getByText, unmount } = render(<Lamp state={st} label={st} />);
      const g = ["●", "◐", "■", "○", "·"].find((x) => {
        try { getByText(x); return true; } catch { return false; }
      });
      unmount();
      return g;
    });
    expect(new Set(glyfy).size).toBe(5);
  });

  it("[JAZYK-02] číslo se nekreslí bez zdroje", () => {
    const { UNSAFE_root } = render(<Measure value="1428" />);
    // Provenience je součástí hodnoty, ne volitelná ozdoba.
    expect(UNSAFE_root.findAllByType(Prov).length).toBeGreaterThan(0);
  });
});

describe("jeden údaj", () => {
  it("[JAZYK-03] prázdný údaj se nekreslí vůbec", () => {
    expect(render(<Fact label="Poznámka" value="" />).toJSON()).toBeNull();
    expect(render(<Fact label="Poznámka" value={null} />).toJSON()).toBeNull();
    expect(render(<Fact label="Poznámka" />).toJSON()).toBeNull();
  });

  it("[JAZYK-03] vyplněný údaj se kreslí i s popiskem", () => {
    const { getByText } = render(<Fact label="Příjemce" value="Novák" />);
    expect(getByText("Příjemce")).toBeTruthy();
    expect(getByText("Novák")).toBeTruthy();
  });
});

describe("naměřená hodnota", () => {
  it("[JAZYK-04] hodnotou je to, co potvrdil ČLOVĚK — ne odhad stroje", () => {
    const { getByText, queryByText } = render(<Measure value="1428" suggested="1423" />);
    expect(getByText("1428")).toBeTruthy();
    // Odhad se smí objevit jen v poznámce o zdroji, nikdy jako hodnota…
    expect(queryByText("1423")).toBeNull();
  });

  it("[JAZYK-05] bez potvrzení člověkem se odhad hodnotou NESTANE, i když existuje", () => {
    const { getByText, queryByText } = render(<Measure suggested="1423" />);
    expect(getByText("—")).toBeTruthy();
    expect(queryByText("1423")).toBeNull();
  });

  it("[JAZYK-06] rozdíl mezi strojem a člověkem je vidět", () => {
    const { getByText } = render(<Measure value="1428" suggested="1423" />);
    expect(getByText(/stroj četl 1423 · přepsáno člověkem/)).toBeTruthy();
  });

  it("[JAZYK-06] shoda se hlásí jako potvrzení, ne jako přepsání", () => {
    // Celý text poznámky, ne jen slovo „potvrzeno“ — to je i v provenienci
    // („ZDROJ: člověk·potvrzeno“), takže samotné slovo by měřilo obojí.
    const { getByText, queryByText } = render(<Measure value="1428" suggested="1428" />);
    expect(getByText("stroj četl 1428 · potvrzeno")).toBeTruthy();
    expect(queryByText(/přepsáno/)).toBeNull();
  });

  it("[JAZYK-07] „12,0“ a „12“ je táž hodnota — porovnává se číselně", () => {
    expect(jeTazHodnota("12,0", "12")).toBe(true);
    expect(jeTazHodnota("12.0", "12")).toBe(true);
    expect(jeTazHodnota("12", "13")).toBe(false);
    // Chybějící hodnota není „shoda“ — nedá se porovnat.
    expect(jeTazHodnota(null, "12")).toBe(false);
    expect(jeTazHodnota("", "")).toBe(false);
  });

  it("[JAZYK-07] shodná hodnota jinak zapsaná se NEhlásí jako přepsání", () => {
    const { queryByText } = render(<Measure value="12,0" suggested="12" />);
    expect(queryByText(/přepsáno/)).toBeNull();
  });
});

describe("evidence", () => {
  it("[JAZYK-08] chybějící doklad se hlásí nahlas a spočítá se", () => {
    const { getByText } = render(
      <Evidence slots={[
        { slot: "stav", label: "Displej", filled: true },
        { slot: "okoli", label: "Okolí", filled: false },
      ]} />,
    );
    expect(getByText("chybí 1")).toBeTruthy();
  });

  it("[JAZYK-08] když je vše zaplněné, nic se nevytýká", () => {
    const { queryByText } = render(
      <Evidence slots={[{ slot: "stav", label: "Displej", filled: true }]} />,
    );
    expect(queryByText(/chybí/)).toBeNull();
  });

  it("[JAZYK-09] evidence nese STAV, ne obrázky", () => {
    const strom = JSON.stringify(
      render(<Evidence slots={[{ slot: "stav", label: "Displej", filled: true }]} />).toJSON(),
    );
    expect(strom).not.toContain("Image");
    expect(strom).not.toContain("uri");
  });
});
