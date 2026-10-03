/**
 * BlockRenderer mluví jazykem — regrese na tom, jak bloky KRESLÍ.
 *
 * Testy v `esdkNativni.test.tsx` dokládají, že komponenty jazyka pravidla drží.
 * Tenhle soubor dokládá něco jiného a stejně důležitého: že je BlockRenderer
 * skutečně POUŽÍVÁ. Komponenta, která pravidlo drží, a obrazovka, která ji
 * nevolá, je pořád rozbitá obrazovka.
 */
import { render } from "@testing-library/react-native";

const mockBlockData = jest.fn();

jest.mock("@/extranet/useSurface", () => ({
  useBlockData: (...a: unknown[]) => mockBlockData(...a),
}));

jest.mock("@/hooks", () => ({
  useTranslation: () => ({ t: (k: string) => k, locale: "cs" }),
}));

// ⛔ NAMĚŘENO 2026-09-11: bez tohohle mocku se sada ani NESPUSTÍ. `BlockRenderer`
// si přitáhne `@/config/api` → `@/config/oidc`, a to volá `Linking.createURL()`
// UŽ PŘI IMPORTU. V Jestu není manifest expo-constants, takže to vyhodí
// „expo-linking needs access to the expo-constants manifest" a spadne celý
// soubor — ne jeden test, ale celá sada. Renderer z `api` používá jediné volání
// (`api.rpc("submit_surface_action", …)`), takže mock má tvar podle
// `useDashboard.test.tsx`: minimální povrch, žádná druhá pravda o API.
const mockRpc = jest.fn();

jest.mock("@/config/api", () => ({
  api: {
    rpc: (...a: unknown[]) => mockRpc(...a),
  },
}));

import { BlockRenderer } from "@/extranet/BlockRenderer";

const blok = (block_type: string) => ({
  block_slug: "b",
  block_type,
  title_key: "t",
  presentation: null,
});

/** Nejmenší politika, se kterou renderer projde — jen `message.length` čte. */
const POLICY = {
  choice: { mode: "steps", count: 1, preselect: false, tradeoffs: false, deferOption: false, inviteOthers: false },
  question: { style: "closed", perMessage: 1 },
  message: { length: "standard", structure: "prose" },
};

function vykresli(block_type: string, data: unknown) {
  mockBlockData.mockReturnValue({
    data: { block_type, data, provenance: { source_slug: "money", freshness_at: null }, target: null },
    isLoading: false,
    isError: false,
  });
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  return render(<BlockRenderer block={blok(block_type) as any} policy={POLICY as any} />);
}

describe("kpi_tile", () => {
  /**
   * ⛔ REGRESE, KTERÁ TU BYLA DO 2026-08-09.
   *
   * `warning` se kreslil POUZE obarvením čísla. Na slunci za sklem kabiny zmizí
   * barevný rozdíl první a barvoslepý ho nemá nikdy — varování tedy bylo pro
   * část řidičů neviditelné a nešlo ho ani vytisknout.
   */
  it("[JAZYK-01] stav ukazatele je čitelný SLOVEM, ne jen barvou", () => {
    const { getByText } = vykresli("kpi_tile", { value: 42, state: "warning" });
    expect(getByText("42")).toBeTruthy();
    // Slovo o stavu musí být přítomné — ať už přeloženo jakkoli.
    expect(getByText("extranet.kpi_state.warning")).toBeTruthy();
  });

  it("[JAZYK-01] neznámý stav padá na `mute`, ne na „v pořádku“", () => {
    // „Nevím, co to je" se nesmí kreslit jako „v pořádku" — to by byl tichý
    // souhlas s něčím, co nikdo nevyhodnotil.
    const { getByText } = vykresli("kpi_tile", { value: 7, state: "neco_noveho" });
    expect(getByText("extranet.kpi_state.neco_noveho")).toBeTruthy();
  });

  it("`null` je NEMĚŘENO, ne nula", () => {
    const { getByText } = vykresli("kpi_tile", { value: null });
    expect(getByText("—")).toBeTruthy();
  });
});

describe("record_detail", () => {
  it("[JAZYK-03] údaj s prázdnou hodnotou se NEKRESLÍ", () => {
    const { queryByText, getByText } = vykresli("record_detail", {
      fields: [
        { key: "prijemce", label_key: "l.prijemce", value: "Novák" },
        { key: "poznamka", label_key: "l.poznamka", value: null },
      ],
    });
    expect(getByText("l.prijemce")).toBeTruthy();
    // Popisek prázdného údaje se nesmí objevit vůbec — jinak vypadá jako údaj
    // a čte se jako „nezjištěno".
    expect(queryByText("l.poznamka")).toBeNull();
  });
});
