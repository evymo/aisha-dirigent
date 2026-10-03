/**
 * Klepátko se musí VYKRESLIT — ne jen být v souboru.
 *
 * ⛔ PROČ TENHLE TEST VEDLE TEXTOVÉ BRÁNY: `cestaKeDverim` měří, že komponenta
 * je vložená do obrazovky selhání startu. To je nutné, ale nestačí — vložená
 * komponenta, která při renderu spadne nebo nic nenakreslí, projde. Tady se
 * proto mountuje doopravdy.
 *
 * ⛔ A HLAVNĚ: klepátko nesmí potřebovat router. Obrazovka selhání startu se
 * kreslí místo `AppShell`, takže žádný `<Stack>` nestojí. Kdyby komponenta
 * router potřebovala, tenhle test spadne — protože ho tu žádný není.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Klepatko } from "@/components";

jest.mock("@/hooks", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
/*
  ⛔ MOCK MUSÍ NÉST CELÝ TVAR, KTERÝ KOMPONENTA POUŽÍVÁ. Když v něm chybí
  funkce, `nativeZarizeni()` je `undefined`, volání vyhodí TypeError — a to
  chytne `try/catch` v komponentě, takže se test tváří zeleně a měří přitom
  stav „průkaz je rozbitý", ne skutečnou cestu. Naměřeno 2026-09-09.
*/
const mockZarizeni = { nacti: jest.fn(), zaved: jest.fn(), zapomen: jest.fn() };
jest.mock("@/lib/knock-native", () => ({
  nativeKnockDeps: () => ({}),
  nativeTabletDeps: () => ({}),
  nativeZarizeni: () => mockZarizeni,
}));

const mockOhlas = jest.fn();
const mockStav = jest.fn();
jest.mock("@/lib/ohlaseniTabletu", () => ({
  ohlasTablet: (...a: unknown[]) => mockOhlas(...a),
  zjistiStavTabletu: (...a: unknown[]) => mockStav(...a),
}));

const mockKnock = jest.fn();
jest.mock("@/lib/knock", () => ({ knockWithCode: (...a: unknown[]) => mockKnock(...a) }));

const mockCil = jest.fn();
const mockKiosk = jest.fn();
jest.mock("@/config/knock", () => ({ jeKiosk: () => mockKiosk(), resolveKnockTarget: () => mockCil() }));

beforeEach(() => {
  jest.clearAllMocks();
  mockCil.mockReturnValue({ target: { host: "d", port: 1 }, chybi: [] });
  mockZarizeni.nacti.mockResolvedValue(null);
  mockZarizeni.zapomen.mockResolvedValue(undefined);
  mockKiosk.mockReturnValue(false);
  mockOhlas.mockResolvedValue({ kid: "dev-abababababababab", stav: "ceka" });
  mockStav.mockResolvedValue({ kid: "dev-abababababababab", stav: "ceka" });
});

describe("klepátko se vykreslí bez routeru", () => {
  it("nabídne pole pro kód i tlačítko", () => {
    render(<Klepatko />);
    expect(screen.getByTestId("klepatko-kod")).toBeTruthy();
    expect(screen.getByTestId("klepatko-tuknout")).toBeTruthy();
  });

  it("instance bez deklarovaných dveří ŤUKAT NENABÍDNE", () => {
    mockCil.mockReturnValue({ target: null, chybi: ["KNOCK_HOST"] });
    render(<Klepatko />);
    expect(screen.queryByTestId("klepatko-tuknout")).toBeNull();
    expect(screen.getByTestId("klepatko-nenastaveno")).toBeTruthy();
  });

  it("⭐ ťuká až na výslovný stisk, samo od sebe nikdy", () => {
    mockKnock.mockResolvedValue({ sent: true });
    render(<Klepatko />);
    expect(mockKnock).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId("klepatko-kod"), "tajne");
    expect(mockKnock).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("klepatko-tuknout"));
    expect(mockKnock).toHaveBeenCalledTimes(1);
  });

  it("⛔ výjimka z ťukání SE CHYTÍ — neodchycená by shodila proces", async () => {
    mockKnock.mockRejectedValue(new Error("sit je pryc"));
    render(<Klepatko />);
    fireEvent.changeText(screen.getByTestId("klepatko-kod"), "tajne");
    fireEvent.press(screen.getByTestId("klepatko-tuknout"));
    await waitFor(() => expect(screen.getByTestId("klepatko-duvod")).toBeTruthy());
    expect(screen.getByTestId("klepatko-duvod")).toHaveTextContent("sit je pryc");
  });

  it("kód nezůstane ve stavu ani po výjimce", async () => {
    mockKnock.mockRejectedValue(new Error("sit je pryc"));
    render(<Klepatko />);
    fireEvent.changeText(screen.getByTestId("klepatko-kod"), "tajne");
    fireEvent.press(screen.getByTestId("klepatko-tuknout"));
    await waitFor(() => expect(screen.getByTestId("klepatko-duvod")).toBeTruthy());
    expect(screen.getByTestId("klepatko-kod").props.value).toBe("");
  });

  it("po odeslání NEŘÍKÁ „otevřeno“ — jen že datagram odešel", async () => {
    mockKnock.mockResolvedValue({ sent: true });
    render(<Klepatko />);
    fireEvent.changeText(screen.getByTestId("klepatko-kod"), "tajne");
    fireEvent.press(screen.getByTestId("klepatko-tuknout"));
    await waitFor(() => expect(screen.getByText("knock.sent")).toBeTruthy());
    expect(screen.queryByText(/otevřeno/i)).toBeNull();
  });
});

/**
 * Průkaz zařízení — cesta, která z ručního ťukání dělá automatické.
 *
 * ⭐ Měří se hlavně to, co se stát NESMÍ: zavedení nesmí proběhnout samo od
 * sebe (jinak by průkaz měl každý telefon a schvalování by nic neznamenalo) a
 * soukromý klíč se nesmí objevit na obrazovce.
 */
describe("průkaz zařízení v klepátku", () => {
  it("bez průkazu nabídne zavedení — ale nezavede nic samo", async () => {
    render(<Klepatko />);

    await waitFor(() => expect(screen.getByTestId("klepatko-zavest")).toBeTruthy());
    expect(mockZarizeni.zaved).not.toHaveBeenCalled();
  });

  it("na stisk zavede a ukáže OTISK, ne soukromý klíč", async () => {
    const publicKeyHex = `04${"ab".repeat(32)}`;
    mockZarizeni.zaved.mockResolvedValue({
      kid: "dev-abababababababab",
      publicKeyHex,
      // ⛔ Bez PEM hlaviček — viz `obsluhaDveri.test.ts`.
      privateKeyPem: "SOUKROMY-KLIC-NESMI-VEN",
    });
    render(<Klepatko />);
    await waitFor(() => expect(screen.getByTestId("klepatko-zavest")).toBeTruthy());

    fireEvent.press(screen.getByTestId("klepatko-zavest"));

    const otisk = await screen.findByTestId("klepatko-otisk");
    const text = String(otisk.props.children.flat().join(""));
    expect(text).toContain("dev-abababababababab");
    expect(text).toContain(publicKeyHex);
    // ⛔ Soukromá půlka se na obrazovku nesmí dostat ANI omylem. Tvrdí se to
    // na PŘESNÉ hodnotě atrapy, ne na slovech „PRIVATE KEY": ta by po přechodu
    // na značku bez PEM hlaviček prošla vždycky, i kdyby klíč unikal.
    expect(text).not.toContain("SOUKROMY-KLIC-NESMI-VEN");
  });

  it("⛔ rozbitý průkaz NEDĚLÁ z telefonu cihlu — jde zapomenout", async () => {
    mockZarizeni.nacti.mockRejectedValue(new Error("uložené pověření je neúplné"));
    render(<Klepatko />);

    await waitFor(() => expect(screen.getByTestId("klepatko-zarizeni-duvod")).toBeTruthy());
    expect(screen.getByTestId("klepatko-zarizeni-duvod").props.children).toContain("neúplné");

    fireEvent.press(screen.getByTestId("klepatko-zapomenout"));
    await waitFor(() => expect(mockZarizeni.zapomen).toHaveBeenCalledTimes(1));
    // A ruční cesta zůstává dosažitelná po celou dobu — to je celý smysl.
    expect(screen.getByTestId("klepatko-tuknout")).toBeTruthy();
  });
});

/*
  TABLET V KIOSKU (2026-09-28) — ohlašuje se bráně sám, protože nikdo přihlášený
  tu není. Telefon řidiče mimo kiosk dál ohlašuje po přihlášení (useNotifications).
*/
describe("tablet v kiosku", () => {
  const PRUKAZ = {
    kid: "dev-abababababababab",
    privateKeyPem: "SOUKROMY-KLIC-NESMI-VEN",
    publicKeyHex: `04${"ab".repeat(64)}`,
    scope: "ops",
  };

  it("po zavedení pošle klíč bráně a ukáže, že čeká na správce", async () => {
    mockKiosk.mockReturnValue(true);
    mockZarizeni.nacti.mockResolvedValueOnce(null).mockResolvedValue(PRUKAZ);
    mockZarizeni.zaved.mockResolvedValue(PRUKAZ);
    render(<Klepatko />);
    await waitFor(() => expect(screen.getByTestId("klepatko-zavest")).toBeTruthy());

    fireEvent.press(screen.getByTestId("klepatko-zavest"));

    await waitFor(() => expect(mockOhlas).toHaveBeenCalled());
    expect(mockOhlas.mock.calls[0][0]).toEqual(PRUKAZ);
    expect(await screen.findByText("knock.tablet_waiting")).toBeTruthy();
    expect(screen.queryByText("knock.device_pending")).toBeNull();
  });

  it("schválený tablet to řekne a znovu se neohlašuje", async () => {
    mockKiosk.mockReturnValue(true);
    mockZarizeni.nacti.mockResolvedValue(PRUKAZ);
    mockStav.mockResolvedValue({ kid: PRUKAZ.kid, stav: "schvaleno" });
    render(<Klepatko />);

    expect(await screen.findByText("knock.tablet_approved")).toBeTruthy();
    expect(mockOhlas).not.toHaveBeenCalled();
  });

  it("průkaz, o kterém brána neví, se ohlásí znovu", async () => {
    mockKiosk.mockReturnValue(true);
    mockZarizeni.nacti.mockResolvedValue(PRUKAZ);
    mockStav.mockResolvedValue({ stav: "nezname" });
    render(<Klepatko />);

    await waitFor(() => expect(mockOhlas).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("knock.tablet_waiting")).toBeTruthy();
  });

  it("zavřené dveře nabídnou ohlásit znovu", async () => {
    mockKiosk.mockReturnValue(true);
    mockZarizeni.nacti.mockResolvedValue(PRUKAZ);
    mockStav.mockResolvedValue({ stav: "nezname" });
    mockOhlas.mockResolvedValue({ stav: "dvere-zavrene" });
    render(<Klepatko />);

    fireEvent.press(await screen.findByTestId("klepatko-tablet-znovu"));
    await waitFor(() => expect(mockOhlas).toHaveBeenCalledTimes(2));
  });

  it("telefon mimo kiosk bráně nic neposílá a radí jako dřív", async () => {
    mockZarizeni.nacti.mockResolvedValue(PRUKAZ);
    render(<Klepatko />);

    expect(await screen.findByText("knock.device_pending")).toBeTruthy();
    expect(mockOhlas).not.toHaveBeenCalled();
    expect(mockStav).not.toHaveBeenCalled();
    expect(screen.queryByTestId("klepatko-tablet")).toBeNull();
  });
});
