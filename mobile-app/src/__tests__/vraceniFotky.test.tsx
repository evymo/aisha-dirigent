/**
 * Smazání fotky se dá vzít zpět.
 *
 * ⛔ PROČ. Pořídit fotku stojí čtyři úkony; SMAZAT ji stál jeden dotek bez
 * ptaní. U rampy se přitom znovu pořídit nedá — paleta je složená, kamion
 * odjel. Destruktivní úkon nesmí být levnější než konstruktivní.
 */
import { useState } from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
import { EvidencePhotos } from "@/components/EvidencePhotos";
import type { PhotoSet, PhotoSlot } from "@/lib/evidencePhotos";

const SLOTY: PhotoSlot[] = [{ key: "doklad" }, { key: "naklad" }];
const FOTKA = { uri: "file:///a.jpg", takenAt: "2026-08-20T10:00:00.000Z" };
const SNIMKY: PhotoSet = { doklad: FOTKA };

function postav(photos: PhotoSet = SNIMKY) {
  const onChange = jest.fn();
  const r = render(<EvidencePhotos slots={SLOTY} photos={photos} onChange={onChange} />);
  fireEvent.press(r.getByTestId("evidence-photos-toggle"));   // rozbalit dlaždice
  return { ...r, onChange };
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe("smazání", () => {
  it("klepnutí na obsazenou dlaždici fotku smaže HNED — přefocení nesmí zdražit dialog", () => {
    const { getByTestId, onChange } = postav();
    fireEvent.press(getByTestId("evidence-photo-doklad"));
    expect(onChange).toHaveBeenCalledWith({ doklad: undefined });
  });

  it("⛔ a nabídne VRÁTIT", () => {
    const { getByTestId } = postav();
    fireEvent.press(getByTestId("evidence-photo-doklad"));
    expect(getByTestId("evidence-vratit")).toBeTruthy();
  });

  it("nabídka je vidět i po sbalení dlaždic — jinak je to pojistka, která nechytá", () => {
    const { getByTestId } = postav();
    fireEvent.press(getByTestId("evidence-photo-doklad"));
    fireEvent.press(getByTestId("evidence-photos-toggle"));   // sbalit
    expect(getByTestId("evidence-vratit")).toBeTruthy();
  });
});

describe("vrácení", () => {
  it("vrátí PŮVODNÍ snímek, ne prázdno", () => {
    const { getByTestId, onChange } = postav();
    fireEvent.press(getByTestId("evidence-photo-doklad"));
    onChange.mockClear();
    fireEvent.press(getByTestId("evidence-vratit-akce"));
    expect(onChange).toHaveBeenCalledWith({ doklad: FOTKA });
  });

  it("po vrácení nabídka mizí", () => {
    const { getByTestId, queryByTestId } = postav();
    fireEvent.press(getByTestId("evidence-photo-doklad"));
    fireEvent.press(getByTestId("evidence-vratit-akce"));
    expect(queryByTestId("evidence-vratit")).toBeNull();
  });
});

describe("vratné okno", () => {
  it("⛔ po vypršení nabídka mizí — trvalý chip by se stal pozadím", () => {
    const { getByTestId, queryByTestId } = postav();
    fireEvent.press(getByTestId("evidence-photo-doklad"));
    act(() => { jest.advanceTimersByTime(20000); });
    expect(queryByTestId("evidence-vratit")).toBeNull();
  });

  it("těsně před vypršením ještě drží", () => {
    const { getByTestId } = postav();
    fireEvent.press(getByTestId("evidence-photo-doklad"));
    act(() => { jest.advanceTimersByTime(19000); });
    expect(getByTestId("evidence-vratit")).toBeTruthy();
  });
});

/**
 * ⛔ SKUTEČNÝ RODIČ, NE ŠPION.
 *
 * Testy výš měří, že se `onChange` zavolá se správnou hodnotou — to je tvrzení
 * o VOLÁNÍ. Jenže komponenta je řízená: `photos` jí chodí zvenčí, takže se
 * `vrat()` uzavírá nad tím, co má PRÁVĚ TEĎ. Kdyby se dosazovalo do zastaralé
 * hodnoty, špion by pořád viděl správný objekt a fotka by se stejně nevrátila.
 *
 * Naměřeno na simulátoru 2026-08-20: po klepnutí na „Vrátit" fotka zpět nebyla.
 * Ukázalo se, že mezitím vypršelo vratné okno — ale rozeznat to od téhle vady
 * nešlo, a to je přesně důvod, proč tenhle test existuje.
 */
function Rodic({ pocatek }: { pocatek: PhotoSet }) {
  const [photos, setPhotos] = useState<PhotoSet>(pocatek);
  return <EvidencePhotos slots={SLOTY} photos={photos} onChange={setPhotos} />;
}

describe("vrácení nad skutečným rodičem", () => {
  it("⛔ fotka je po vrácení OPRAVDU zpět — ne jen správně zavolaná", () => {
    const r = render(<Rodic pocatek={SNIMKY} />);
    fireEvent.press(r.getByTestId("evidence-photos-toggle"));
    // Před smazáním je dlaždice obsazená: nese čas pořízení.
    expect(r.queryByText(/\d{1,2}:\d{2}/)).toBeTruthy();

    fireEvent.press(r.getByTestId("evidence-photo-doklad"));
    expect(r.queryByText(/\d{1,2}:\d{2}/)).toBeNull();      // smazáno

    fireEvent.press(r.getByTestId("evidence-vratit-akce"));
    expect(r.queryByText(/\d{1,2}:\d{2}/)).toBeTruthy();    // a je zpět
    expect(r.queryByTestId("evidence-vratit")).toBeNull();
  });

  it("⛔ vrácení NEZAHODÍ fotku v jiném slotu", () => {
    const r = render(<Rodic pocatek={{ doklad: FOTKA, naklad: FOTKA }} />);
    fireEvent.press(r.getByTestId("evidence-photos-toggle"));
    fireEvent.press(r.getByTestId("evidence-photo-doklad"));
    fireEvent.press(r.getByTestId("evidence-vratit-akce"));
    expect(r.queryAllByText(/\d{1,2}:\d{2}/)).toHaveLength(2);
  });
});

describe("klid", () => {
  it("bez smazání se nic nenabízí", () => {
    const { queryByTestId } = postav();
    expect(queryByTestId("evidence-vratit")).toBeNull();
  });
});
