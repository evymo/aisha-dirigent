/**
 * Moje kroky — field completion of assigned workflow nodes (generic surface
 * over the production workflow system; the delivery handover is just one
 * template). The card asks ONLY for what the human on site knows — identity
 * of the recipient, item check, note; machines fill the rest through their
 * own observations. Completing a node pays the reward declared on the
 * template node (shown on the card, confirmed in the success banner).
 */
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  TextInput, Switch, TouchableOpacity, KeyboardAvoidingView, Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "@/hooks";
import { colors, spacing } from "@/theme";
import { useMyWorkflowSteps, useWorkflowStep, usePolozkyKroku, useCompleteWorkflowStep, useSubmitHandover, useSubmitMeterReading, type WorkflowStep, type WorkflowStepDetail } from "@/hooks/useWorkflowSteps";
import { MomentPodpisu, type UdajPredani } from "@/components/MomentPodpisu";
import { PruhFronty } from "@/components/PruhFronty";
import { DoorClosed, MessageSquareWarning } from "lucide-react-native";
import { zahrajOdezvu, type Povaha } from "@/lib/odezva";
import { sloupec } from "@/lib/sirkaObsahu";
import { obalRozlozeni, useRozlozeni } from "@/lib/rozlozeni";
import { PaskaKroku } from "@/components/PaskaKroku";
import { ListPredani, type PredanoStav } from "@/components/ListPredani";
import { ZkoseneTlacitko } from "@/components/ZkoseneTlacitko";
import { casNaRazitku, chybiKPotvrzeni, dalsiZastavka } from "@/lib/predani";
import { EvidencePhotos } from "@/components/EvidencePhotos";
import { Es } from "@/extranet/esdk";
import { HeroZastavky } from "@/extranet/HeroZastavky";
import { photoSlots, photoCount, type PhotoSet } from "@/lib/evidencePhotos";
import { readMeterFromPhoto } from "@/lib/meterOcr";
import { uploadEvidenceSet } from "@/lib/uploadEvidence";
import { useOffline } from "@/hooks/useOffline";
import { classifyFailure, enqueueMutation } from "@/services/offline";
import { zachranaPrace } from "@/lib/zachranaPrace";
import { zkusDvere } from "@/lib/obsluhaDveri";
import { nativeObsluhaDveri } from "@/lib/obsluhaDveri-native";
import { klic as klicPrebirajici, nabidka, zapamatuj, zParsuj, type Pamet } from "@/lib/prebirajici";
import { cisloDokladu, coSePredava, podtitulKroku } from "@/lib/coSePredava";
import { cilZPolozek, polozkyZKroku, type PolozkaKZobrazeni } from "@/lib/polozkyDokladu";
import { getUser } from "@/config/oidc";
import { jeKiosk } from "@/config/knock";
import { zjistiPolohuPredani, type DevicePositionPayload } from "@/lib/polohaZarizeni";
import { nativePolohaDeps } from "@/lib/polohaZarizeni-native";
import type { Json } from "@/types/database";

/**
 * Je tenhle uzel odečtem?
 *
 * Ptá se DAT, ne jména kroku: uzel, který nese subjekt (`subject_twin_id` =
 * měřidlo, ke kterému hodnota patří), se odbavuje potvrzením HODNOTY. Kdyby se
 * to řídilo `step_code === "odecet"`, byl by v appce zadrátovaný jeden proces
 * jednoho zákazníka a druhý zákazník by potřeboval release.
 */
/** Slot, na kterém je displej — z něj se čte hodnota (viz šablona odečtu). */
const MEASURE_SLOT = "stav";

function isMeterReadingStep(step: WorkflowStep): boolean {
  const input = step.input_data as { subject_twin_id?: unknown } | null;
  return typeof input?.subject_twin_id === "string" && input.subject_twin_id.length > 0;
}

/**
 * Barva podle POVAHY výsledku.
 *
 * ⛔ Dosud byl rám JEDEN (oranžový) pro všechno: „odesláno + odměna" i
 * „uloženo, odejde samo" vypadaly stejně. Barva je tady jediný kanál, který
 * ten rozdíl unese na první pohled — text lidé u rampy nečtou celý.
 *
 * ⭐ Všechny čtyři jsou SVĚTLÉ plochy s tmavým textem (`colors.background`),
 * takže kontrast drží u všech stejně; kdyby některá byla tmavá, měnil by se
 * i text a rám by se rozpadl na čtyři různé komponenty.
 */
/**
 * Povaha hlášky → TÓN jazyka. Dřív to byla mapa na BARVU pozadí, tedy jediný
 * kanál; `Banner` z tónu odvodí glyf i barvu, takže stav zůstane čitelný i pro
 * toho, kdo barvy nerozliší — a v protisvětle v kabině je to většina z nás.
 */
/**
 * Stav kroku → LAMPA. Stav je slovo i glyf, ne barva: `Lamp` kreslí ● ◐ ■ ○
 * vedle textu, takže „hotovo" a „selhalo" jde rozlišit i v protisvětle a i tím,
 * kdo barvy nerozliší. Neznámý stav padá do `plan`, ne do zdravého — měřidlo
 * nesmí být fail-open.
 */
const LAMPA_STAVU: Record<string, "ok" | "work" | "wait" | "fault" | "plan"> = {
  completed: "ok",
  in_progress: "work",
  pending: "plan",
  failed: "fault",
};

const TON_HLASKY: Record<Povaha, "ok" | "info" | "wait" | "fault"> = {
  hotovo: "ok",
  fronta: "info",
  pozor: "wait",
  chyba: "fault",
};

/*
 * ⛔ TADY BYLA TŘETÍ RUČNĚ PSANÁ KOPIE SLOVA `Fact`.
 *
 * Týž zákon („prázdné se nekreslí") byl opsaný na třech místech: ve webovém
 * ESDK (`es-fact`), v nativním kitu (`Fact`) a znovu tady. Kopie se nerozešly
 * náhodou — nic je neporovnávalo. Od 0.3.0 má `Fact` variantu `row`, takže
 * uspořádání dokladu (klíč vlevo, hodnota vpravo) umí jazyk sám a obrazovka
 * si ho nemusí psát.
 */

export default function KrokyScreen() {
  const okraje = useSafeAreaInsets();
  const { t } = useTranslation();
  const steps = useMyWorkflowSteps();
  // Rozložení podle DOSTUPNÉ PLOCHY, ne podle zařízení (viz lib/rozlozeni).
  const { dvousloupec } = useRozlozeni();
  /**
   * ⭐ OTEVŘENÍ KONKRÉTNÍHO KROKU (`/kroky?step=<id>`).
   *
   * Sem vede klepnutí ve frontě — v řidičově pásce i v dispečerském seznamu.
   * Je to VĚDOMĚ TÁŽ OBRAZOVKA: kdo odbavuje cizí předání, má vidět přesně to,
   * co vidí řidič, a ne zjednodušenou administrátorskou náhradu, která by se
   * postupně rozešla. Nárok řeší server (`get_workflow_step_detail` volá sdílený
   * predikát s dispečerským rozsahem), takže tenhle parametr nic neotevírá —
   * jen se ptá.
   */
  const { step: stepParam, akce } = useLocalSearchParams<{ step?: string; akce?: string }>();
  const focusedQuery = useWorkflowStep(stepParam);
  const focused: WorkflowStepDetail | null = stepParam ? focusedQuery.data ?? null : null;
  const complete = useCompleteWorkflowStep();
  const handover = useSubmitHandover();
  const meterReading = useSubmitMeterReading();

  const [openStepId, setOpenStepId] = useState<string | null>(null);

  /**
   * OBSAH DODÁVKY — materiál a množství z DOKLADU, vydané S KROKEM.
   *
   * ⭐ JEDEN DOTAZ, ZA JEDEN KROK. Hook nejde volat uvnitř `map`, a hlavně by
   *    to nedávalo smysl: fronta má až 50 položek a stahovat detail ke všem
   *    znamená 50 dotazů kvůli jedné kartě, kterou má člověk zrovna otevřenou.
   *    Ptáme se tedy za krok, který je rozbalený (nebo otevřený přes `?step=`).
   *
   * ⭐ S KROKEM, NE PŘES REGISTR (majitel 2026-09-30: „nevidím detail dodávky — co,
   *    kolik a čeho odvézt“). Položky zůstávají v registru, server je vydá tomu, kdo
   *    vidí KROK — i tabletu v kabině, který na registr nárok nemá (jen klíče, které
   *    instance pustí). Ukazatel na doklad klient nepotřebuje ani nedostane.
   */
  const zamerenyKrok = focused ?? steps.data?.find((s) => s.step_id === openStepId) ?? null;
  const polozkyKroku = usePolozkyKroku(zamerenyKrok?.step_id ?? null);
  const polozky: PolozkaKZobrazeni[] = polozkyZKroku(polozkyKroku.data?.polozky);
  const [recipient, setRecipient] = useState("");
  /**
   * LIST PŘEDÁNÍ (bod 3 vizuálu, maketa `Handover`): krok, pro který je otevřený,
   * jeho pořadí 1 Kontrola → 2 Podpis a razítko „Předáno" po potvrzení.
   *
   * ⭐ Drží se CELÝ krok, ne jen id: po odeslání se fronta obnoví a krok z ní
   *    zmizí — razítko ale musí ještě vědět, co se předalo.
   * ⛔ Přepínač „Položky souhlasí" zmizel: souhlas je teď úkon („Souhlasí · k podpisu"),
   *    nesouhlas je VÝHRADA (majitel 19. 8.: výhrada = poznámka, odchylka není páka
   *    řidiče). `items_ok` proto nese true ze stisku, ne z přepínače.
   */
  const [predavam, setPredavam] = useState<WorkflowStep | null>(null);
  const [krokPredani, setKrokPredani] = useState<0 | 1>(0);
  const [vyhradaOtevrena, setVyhradaOtevrena] = useState(false);
  const [predano, setPredano] = useState<PredanoStav | null>(null);
  const akceOtevrena = useRef<string | null>(null);
  const [deviation, setDeviation] = useState(false);
  const [note, setNote] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PhotoSet>({});
  /**
   * ⛔ HLÁŠKA NESE POVAHU, NE JEN TEXT.
   *
   * Dosud tu byl `string` a jeden rám: „odesláno + odměna" a „uloženo, odejde
   * samo" vypadaly IDENTICKY. Řidič pak odjede od rampy s dojmem, že práce je
   * na serveru, a ona je v telefonu. Povaha rozhoduje o barvě i o tom, co
   * člověk ucítí v ruce (`lib/odezva.ts`).
   */
  const [banner, setBanner] = useState<{ text: string; povaha: Povaha } | null>(null);
  /**
   * Odmítl nás server, nebo jen chybí signál?
   *
   * ⭐ Tenhle rozdíl je celý smysl téhle proměnné. `false` znamená i „nevím" —
   * nabídku zaklepání smí rozsvítit VÝHRADNĚ doložené odmítnutí identity
   * (401/403). Kdyby ji zapínal každý neúspěch, appka by kód chtěla i v tunelu
   * a naučila by lidi zadávat break-glass materiál rutinně; tím by ztratil smysl.
   */
  const [zamceno, setZamceno] = useState(false);
  /**
   * ⛔ DŘÍV SE ODSUD BRAL JEDINÝ ÚDAJ (`isConnected`) — a fronta tím byla
   * neviditelná. Řidič se o ní dozvěděl z hlášky, která za tři vteřiny zmizela;
   * od té chvíle neměl jak zjistit, jestli práce odešla. Zbytek stavu tu byl
   * celou dobu, jen ho nikdo nekreslil (viz `PruhFronty`).
   */
  const { isConnected, isProcessing, needsAttention, queueSize, storeUnreadable,
          processQueue, refreshQueueSize } = useOffline();
  // Hodnota odečtu jako TEXT: pole je editovatelné a člověk do něj píše. Držet
  // to jako number by znamenalo rozhodovat za něj při každém stisku klávesy
  // (co je "12," nebo prázdno) — převod patří až k odeslání.
  const [reading, setReading] = useState("");
  // Co appka vyčetla z displeje, než to člověk potvrdil. Zůstává vedle hodnoty
  // jako stopa kvality čtečky; autoritou je vždy to, co je v poli.
  const [suggested, setSuggested] = useState<number | null>(null);
  /**
   * Vlastní paměť řidiče: koho u které protistrany naposledy zapsal.
   *
   * ⛔ NEJDE o data zakázky. `input_data` nese `counterparty` (FIRMU), ne osobu —
   * předvyplnit firmu do pole „Přebírající (jméno)" by byl vymyšlený údaj
   * v dokladu. Nabízí se proto výhradně to, co člověk sám dřív potvrdil, a to
   * KLEPNUTÍM, nikdy dosazením (viz lib/prebirajici.ts).
   */
  const [pamet, setPamet] = useState<Pamet>({});
  /** Otevřený moment podpisu — telefon právě drží přebírající. */
  const [podepisujeSe, setPodepisujeSe] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  /** Tablet v kabině bez přihlášeného člověka — mluví za něj účet zařízení. */
  const kioskBezCloveka = jeKiosk() && !uid;

  /**
   * Říct člověku, jak to dopadlo — očima i rukou naráz.
   *
   * ⚠️ Odezva se NEČEKÁ (`void`): hmat je pomůcka a nesmí zdržet překreslení
   * ani shodit úkon, který je jinak hotový.
   */
  const rekni = (povaha: Povaha, text: string) => {
    setBanner({ povaha, text });
    void zahrajOdezvu(povaha);
  };

  /**
   * Práce je PRYČ Z RUKOU ŘIDIČE — odeslaná, nebo bezpečně ve frontě. U předání
   * z listu k tomu patří razítko „Předáno" s tím, co se právě zapsalo.
   *
   * ⭐ Hodnoty (jméno, fotky, výhrada) se berou z téhož vykreslení, ve kterém člověk
   *    stiskl „Potvrdit" — tedy přesně to, co odešlo, ne to, co je ve formuláři teď.
   * ⛔ Odečet list nemá (`predavam` je jiný krok) → jen hláška jako dřív.
   */
  const dokonceno = (
    step: WorkflowStep,
    occurredAt: string,
    povaha: Povaha,
    text: string,
    zpravaListu?: string,
    odmena: PredanoStav["odmena"] = null,
  ) => {
    rekni(povaha, text);
    setOpenStepId(null);
    if (predavam?.step_id !== step.step_id) return;
    const dalsi = dalsiZastavka(steps.data ?? [], step.step_id);
    const vstupDalsi = (dalsi?.input_data ?? null) as Record<string, unknown> | null;
    const textPole = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const fotek = photoCount(photos);
    setPredano({
      doklad: cisloDokladu(step),
      cas: casNaRazitku(occurredAt),
      prebirajici: recipient.trim() || null,
      povaha,
      zprava: zpravaListu ?? text,
      odmena,
      radky: [
        { label: t("handover.done.signedBy"), value: signature ? t("handover.done.signed") : null },
        { label: t("handover.done.photos"), value: fotek ? t("handover.done.pieces", { n: fotek }) : null },
        { label: t("handover.done.claim"), value: note.trim() || null },
      ],
      dalsi: dalsi
        ? {
            nadpis: textPole(vstupDalsi?.counterparty) ?? dalsi.step_name,
            podnadpis: textPole(vstupDalsi?.delivery_address) ?? (podtitulKroku(dalsi) || null),
          }
        : null,
    });
  };

  /** Otevřít list předání. Jiná dodávka = čistý formulář (viz `vycistiFormular`). */
  function otevriPredani(step: WorkflowStep) {
    if (predavam?.step_id !== step.step_id && openStepId !== step.step_id) vycistiFormular();
    setBanner(null);
    setPredano(null);
    setKrokPredani(0);
    // Otevřený krok = zaměřený → stáhne se k němu doklad (položky pro kontrolu).
    setOpenStepId(step.step_id);
    setPredavam(step);
  }

  /** Po razítku zpět tam, odkud řidič přišel — na pásku, když přišel z ní. */
  const pokracovat = () => {
    setPredano(null);
    setPredavam(null);
    setKrokPredani(0);
    vycistiFormular();
    // „Zamčeno" si banner s cestou ke dveřím nechá; ostatní řeklo razítko.
    setBanner((b) => (b?.povaha === "pozor" ? b : null));
    if (stepParam && router.canGoBack()) router.back();
  };

  /**
   * ⛔ ODESÍLÁNÍ JE ZAMČENÉ CELÉ, ne jen volání serveru (2026-09-29). Dřív `busy` krylo
   * jen mutace — poloha (až 8 s, případně dotaz na oprávnění) a nahrávání fotek běžely
   * s živým tlačítkem a původním popiskem, takže druhé klepnutí poslalo předání dvakrát.
   * `odeslaniBezi` je synchronní pojistka (stav Reactu se projeví až po překreslení).
   */
  const [odesilam, setOdesilam] = useState(false);
  const odeslaniBezi = useRef(false);
  const busy = odesilam || complete.isPending || handover.isPending || meterReading.isPending;

  // S parametrem se obrazovka zužuje na JEDEN krok — i cizí. Bez něj je to
  // pořád osobní fronta a nic se nemění.
  const all: WorkflowStep[] = focused ? [focused] : stepParam ? [] : steps.data ?? [];
  // ⭐ MASTER–DETAIL: páska si drží CELOU frontu, i když detail ukazuje jeden
  // krok. Právě v tom je ten druhý sloupec k něčemu — řidič vidí, co ho čeká,
  // aniž by se musel vracet. `all` výš zůstává BEZE ZMĚNY: detail se nemění,
  // jen k němu vlevo přibude rejstřík.
  const doPasky: WorkflowStep[] = steps.data ?? [];
  const active = all.filter((s) => s.status !== "completed" && s.status !== "failed");
  const done = all.filter((s) => s.status === "completed" || s.status === "failed");

  // Otevřený krok rovnou rozbalí formulář — člověk sem přišel kliknutím na
  // konkrétní položku, takže druhé klepnutí by bylo jen práce navíc.
  //
  // ⛔ JINÁ DODÁVKA = ČISTÝ FORMULÁŘ (2026-09-29). Na tabletu se dodávka přepíná páskou
  // vlevo a dřív tu zůstal přebírající, poznámka, fotky i PODPIS z předchozí — u dodávky
  // B by se ukázal a odeslal podpis sebraný u A. U právního důkazu předání je to
  // nejhorší možná záměna, proto se nuluje tady, u zdroje, ne až v odeslání.
  useEffect(() => {
    if (!focused?.step_id) return;
    vycistiFormular();
    setOpenStepId(focused.step_id);
    // vycistiFormular jen nastavuje stav — závislost je jen na změně dodávky.
  }, [focused?.step_id]);

  /**
   * CTA „Předání a podpis" na pásce otevře rovnou list (maketa: NowCard → Handover).
   * Jen jednou za krok, jen předání (odečet list nemá) a jen dokud není hotové.
   */
  const otevriPredaniPosledni = useRef(otevriPredani);
  useEffect(() => {
    otevriPredaniPosledni.current = otevriPredani;
  });
  useEffect(() => {
    if (akce !== "predat" || !focused) return;
    if (akceOtevrena.current === focused.step_id) return;
    if (isMeterReadingStep(focused) || focused.status === "completed" || focused.status === "failed") return;
    akceOtevrena.current = focused.step_id;
    // Přes ref: spouští to PŘÍCHOD na krok s akcí, ne každé překreslení.
    otevriPredaniPosledni.current(focused);
  }, [akce, focused]);

  // Paměť je vázaná na přihlášeného — na sdíleném telefonu se vzpomínky nemíchají.
  useEffect(() => {
    let zivy = true;
    (async () => {
      const u = await getUser().catch(() => null);
      // ⛔ Tablet v kiosku (F2) paměť přebírajících NEMÁ: bez přihlášeného člověka tu
      // `getUser()` vrací null záměrně. Tablet sdílí víc řidičů a jména lidí na straně
      // odběratele by se nabízela dalším — přesně ten osobní údaj, který na tablet nepatří
      // (majitel 2026-09-29).
      const id = u?.id ?? null;
      if (!zivy || !id) return;
      setUid(id);
      setPamet(zParsuj(await AsyncStorage.getItem(klicPrebirajici(id)).catch(() => null)));
    })();
    return () => { zivy = false; };
  }, []);

  /**
   * Vyfocení displeje u odečtu: hned se z něj zkusí přečíst hodnota.
   *
   * ⭐ NÁVRH SE DOSADÍ, JEN KDYŽ JE POLE PRÁZDNÉ. Když už člověk něco napsal,
   * jeho hodnota je autorita a stroj mu ji nesmí přepsat — ani kdyby fotil
   * podruhé. Nepřečteno = pole zůstane, jak je; OCR je pomůcka, ne podmínka.
   */
  const onReadingPhotos = async (next: PhotoSet) => {
    setPhotos(next);
    const shot = next[MEASURE_SLOT] ?? Object.values(next).find(Boolean);
    if (!shot) return;
    const guess = await readMeterFromPhoto(shot.uri);
    if (!guess) return;
    setSuggested(guess.value);
    setReading((current) => (current.trim() ? current : String(guess.value)));
  };

  /**
   * Co uvidí PŘEBÍRAJÍCÍ, když mu řidič podá telefon.
   *
   * ⭐ Vybráno VÝSLOVNĚ, ne „co zbylo": jsou to údaje o DODÁVCE, podle kterých
   * si ji porovná s tím, co má před sebou na rampě. Prázdné se nekreslí.
   *
   * ⛔ CO TU SCHVÁLNĚ NENÍ: odměna řidiče (`+N ASH`), `assigned_role`
   * a `assigned_to`. To jsou údaje PROVOZU, ne dodávky — přebírajícího se
   * netýkají a drží ten telefon v ruce. Filtr je tady, ne v komponentě:
   * `MomentPodpisu` žádný údaj nezná, takže se nedá obejít změnou dat.
   */
  /**
   * Popis dodávky vyrábí `lib/coSePredava` — jeden výrobce pro hlavičku,
   * kartu „Náklad a doklad" i podpisový modál. Obrazovka jen překládá
   * popiskové klíče; proč která hodnota chybí nebo přibyla, stojí tam.
   */
  const dokladCislo = cisloDokladu;
  const udajePro = (step: WorkflowStep): UdajPredani[] =>
    coSePredava(step).map((u) => ({ label: t(u.labelKey), value: u.value }));

  /**
   * ÚDAJE PRO PODPISOVÝ OKAMŽIK — co vidí PŘEBÍRAJÍCÍ, než se podepíše.
   *
   * ⛔ VYJÁDŘENÍ SE PODEPISOVALO NEVIDĚNÉ. Text píše řidič, ale podle toho, co
   *    mu řekne zákazník — a stvrzuje ho podpisem přebírající. Ten ho ale
   *    v `MomentPodpisu` neviděl: sada údajů nesla doklad, odběratele, kam
   *    a vozidlo, vyjádření ne. Člověk se tak podepisoval pod větu napsanou
   *    jeho jménem, kterou si nemohl přečíst.
   *
   * ⭐ PROČ NE PŘES `coSePredava`: ta popisuje, co dodávka JE — hodnoty, které
   *    už jsou uložené v kroku. Tohle je naopak text, který se právě teď píše
   *    a ještě nikde není. Slít to do jednoho výrobce by znamenalo tvrdit
   *    o rozepsané poznámce, že je vlastností dokladu.
   *
   * Prázdné se nepřidává (JAZYK-03) — bez vyjádření zůstane okamžik stejný
   * jako dřív, jen o řádek kratší.
   */
  const udajeKPodpisu = (step: WorkflowStep, vyjadreni: string): UdajPredani[] => {
    const text = vyjadreni.trim();
    return text
      ? [...udajePro(step), { label: t("workflow.steps.note"), value: text }]
      : udajePro(step);
  };

  /**
   * NÁKLAD A DOKLAD — druhá karta makety, hned pod hlavičkou.
   *
   * Maketa (`driver-handover.jsx`, `StopDetail`) staví pořadí takhle: co to je
   * a v jakém stavu → CO SE VEZE A KOMU → teprve pak úkony. Obrazovka měla
   * první a třetí, prostřední chybělo, takže řidič viděl jméno kroku, termín
   * a roli — ale ne komu veze a kam.
   *
   * ⭐ Není to nový čtenář dat: kreslí se PŘESNĚ to, co vyrábí `udajePro` pro
   *    podpisový modál. Jeden výrobce, dva pohledy — kdyby se sada měnila,
   *    nemůže se rozejít.
   *
   * ⛔ `Es.Prov` JEN KDYŽ ZNÁM STÁŘÍ. `Prov` má výchozí `freshness="aktuální"`
   *    — to je tvrzení o čerstvosti, které bych si vymyslel. Ve frontě
   *    (`WorkflowStep`) datum nemám, v detailu (`production_date`) ano; kde
   *    ho nemám, razítko se nekreslí. Radši žádný zdroj než vymyšlený.
   */
  const nakladADoklad = (step: WorkflowStep, datum?: string | null) => {
    const udaje = udajePro(step).filter((u) => u.value);
    if (udaje.length === 0) return null; // JAZYK-03: prázdné se nekreslí
    const cisloNaPapire = dokladCislo(step);
    return (
      <>
        <Es.Sect>{t("workflow.step.cargoSection")}</Es.Sect>
        <Es.Card tight>
          {udaje.map((u) => (
            <Es.Fact key={u.label} row label={u.label} value={u.value} />
          ))}
          {/*
            OBSAH DODÁVKY. Řádky dokladu, ne pole kroku — proto se kreslí jen
            u kroku, ke kterému jsme detail stáhli. Tabulka je slovo jazyka;
            vlastní mřížku tu psát nebudeme.

            ⛔ NIC SE NESČÍTÁ. Množství jsou údaje z papíru; součet by byl nové
            tvrzení o dodávce, které na obrazovce vznikat nemá.
          */}
          {step.step_id === zamerenyKrok?.step_id && polozky.length > 0 ? (
            <View style={{ marginTop: spacing.sm }}>
              <Es.Table
                data={{
                  columns: [
                    { key: "nazev", label: t("workflow.step.itemName") },
                    { key: "mnozstvi", label: t("workflow.step.itemQty"), num: true },
                  ],
                  rows: polozky.map((it) => ({
                    nazev: it.cekaNaKontrolu ? `${it.nazev} ⚠` : it.nazev,
                    mnozstvi: it.mnozstvi,
                  })),
                }}
              />
              {/*
                Řádky, které NEPROŠLY branami, se nezamlčují. Hvězdička u názvu
                říká „tohle ještě čeká na člověka" — schovat to by znamenalo
                vydat rozpracovaný údaj za hotový.
              */}
              {polozky.some((it) => it.cekaNaKontrolu) ? (
                <Es.Fact
                  row
                  tone="warn"
                  label={t("workflow.step.itemsPending")}
                  value={String(polozky.filter((it) => it.cekaNaKontrolu).length)}
                />
              ) : null}
            </View>
          ) : null}
          {cisloNaPapire && datum ? (
            <View style={{ marginTop: spacing.sm }}>
              <Es.Prov
                source={t("workflow.step.cargoSource", { doc: cisloNaPapire })}
                freshness={datum.slice(0, 10)}
              />
            </View>
          ) : null}
        </Es.Card>
      </>
    );
  };

  /** Co nabídnout u tohohle kroku — `null` = nic a pole zůstane prázdné. */
  const navrhPrebirajiciho = (step: WorkflowStep): string | null =>
    nabidka(pamet, step.input_data, new Date());

  /**
   * KROK 1 LISTU — KONTROLA. Co se veze a komu (karta nákladu s řádky dokladu), pod tím
   * „Jen když je co řešit": fotky a výhrada. Nic z toho není povinné; souhlas je stisk
   * „Souhlasí · k podpisu".
   *
   * ⛔ Z makety tu NENÍ hmotnost „doplněná senzory" se stepperem — senzor korby nemáme
   *    a rozdíl proti dokladu je nález, ne editace řidičem (majitel 30. 7.).
   */
  const kontrolaPredani = (step: WorkflowStep) => (
    <>
      {nakladADoklad(step, focused?.step_id === step.step_id ? focused.production_date : null)}
      <Es.Card tight>
        <Es.Overline>{t("handover.extra.title")}</Es.Overline>
        <Text style={styles.extraHint}>{t("handover.extra.hint")}</Text>
        <View style={styles.photosRow}>
          <EvidencePhotos
            slots={photoSlots(step.input_data as Json | null)}
            photos={photos}
            onChange={setPhotos}
          />
        </View>
        {vyhradaOtevrena || note.trim() ? (
          <>
            <Text style={styles.label}>{t("handover.extra.claim")}</Text>
            <TextInput
              style={[styles.input, styles.noteInput]}
              value={note}
              onChangeText={setNote}
              placeholder={t("handover.extra.claimPlaceholder")}
              placeholderTextColor={colors.textSecondary}
              multiline
              testID="kroky-note"
            />
            <View style={styles.vyhradaPata}>
              <TouchableOpacity
                onPress={() => { setNote(""); setVyhradaOtevrena(false); }}
                accessibilityRole="button"
                testID="predani-vyhrada-zrusit"
              >
                <Text style={styles.odkaz}>{t("handover.extra.claimCancel")}</Text>
              </TouchableOpacity>
              <Text style={[styles.extraHint, styles.vyhradaHint]}>{t("handover.extra.claimHint")}</Text>
            </View>
          </>
        ) : (
          <TouchableOpacity
            style={styles.vyhradaTlacitko}
            onPress={() => setVyhradaOtevrena(true)}
            accessibilityRole="button"
            testID="predani-vyhrada"
          >
            <MessageSquareWarning size={16} color={colors.text} />
            <Text style={styles.vyhradaText}>{t("handover.extra.claim")}</Text>
          </TouchableOpacity>
        )}
        {/* Odchylka je páka DISPEČERA u cizího kroku, ne řidiče (majitel 19. 8.). */}
        {focused && !focused.is_mine && (
          <View style={styles.switchRow}>
            <Text style={styles.label}>{t("workflow.steps.deviation")}</Text>
            <Switch value={deviation} onValueChange={setDeviation} testID="kroky-deviation" />
          </View>
        )}
      </Es.Card>
    </>
  );

  /**
   * KROK 2 LISTU — PODPIS. Jméno přebírajícího (nepředvyplněné, jen nabídka vlastního
   * posledního zápisu) a podpis v `MomentPodpisu` přes celou obrazovku — telefon drží
   * přebírající a vidí, co podepisuje (majitel 20. 8.). Pod tím shrnutí předávaného.
   *
   * ⛔ PIN zákazníka z makety není: PINy nikdo nedistribuuje (stojí na objednávkách).
   */
  const podpisPredani = (step: WorkflowStep) => {
    const cil = step.step_id === zamerenyKrok?.step_id ? cilZPolozek(polozky) : null;
    const navrh = navrhPrebirajiciho(step);
    return (
      <>
        <Es.Card tight>
          <Es.Overline>{t("handover.sign.title")}</Es.Overline>
          <Text style={styles.label}>{t("workflow.steps.recipient")}</Text>
          <TextInput
            style={styles.input}
            value={recipient}
            onChangeText={setRecipient}
            placeholder={t("workflow.steps.recipientPlaceholder")}
            placeholderTextColor={colors.textSecondary}
            testID="kroky-recipient"
          />
          {/*
            ⛔ NEDOSAZUJE SE. Tichý prefill by po týdnu vyrobil doklady se jménem člověka,
            který u toho nebyl. Klepnutí je okamžik potvrzení (JAZYK-05).
          */}
          {!recipient.trim() && navrh ? (
            <TouchableOpacity
              style={styles.navrh}
              onPress={() => setRecipient(navrh)}
              accessibilityRole="button"
              testID="kroky-recipient-navrh"
            >
              <Text style={styles.navrhText}>{t("workflow.steps.recipientLast", { name: navrh })}</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={styles.label}>{t("handover.signature")}</Text>
          {signature ? (
            <View style={styles.podepsano} testID="kroky-podepsano">
              <Text style={styles.podepsanoText}>{t("handover.moment.podepsano")}</Text>
              <TouchableOpacity
                onPress={() => { setSignature(null); setPodepisujeSe(step.step_id); }}
                accessibilityRole="button"
                testID="kroky-podpis-znovu"
                style={styles.podepsanoZnovu}
              >
                <Text style={styles.podepsanoZnovuText}>{t("handover.moment.znovu")}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.podat}
              onPress={() => setPodepisujeSe(step.step_id)}
              accessibilityRole="button"
              testID="kroky-podat-k-podpisu"
            >
              <Text style={styles.podatText}>{t("handover.moment.podat")}</Text>
            </TouchableOpacity>
          )}
          <MomentPodpisu
            visible={podepisujeSe === step.step_id}
            udaje={udajeKPodpisu(step, note)}
            polozky={step.step_id === zamerenyKrok?.step_id ? polozky : undefined}
            podepisujici={recipient.trim() || null}
            predmet={cisloDokladu(step)}
            onZrusit={() => setPodepisujeSe(null)}
            onHotovo={(uri) => { setSignature(uri); setPodepisujeSe(null); }}
          />
        </Es.Card>
        <Es.Card tight>
          <Es.Fact row label={t("workflow.step.doc")} value={cisloDokladu(step)} />
          <Es.Fact
            row
            label={t("handover.sign.cargo")}
            value={
              cil
                ? [cil.hlavni, cil.doplnek, cil.dalsich ? t("extranet.tape.moreItems", { n: cil.dalsich }) : null]
                    .filter(Boolean)
                    .join(" · ")
                : null
            }
          />
          <Es.Fact row tone="warn" label={t("handover.sign.claim")} value={note.trim() ? t("handover.sign.claimYes") : null} />
        </Es.Card>
      </>
    );
  };

  /** Čistý formulář pro JINOU dodávku — nic z předchozí nesmí přejít dál. */
  function vycistiFormular() {
    setRecipient(""); setDeviation(false); setNote(""); setVyhradaOtevrena(false);
    setSignature(null); setPhotos({});
    setReading(""); setSuggested(null);
  }

  /**
   * Sbalení TÉŽE dodávky rozepsané údaje NEMAŽE (dřív klepnutí na hlavičku smazalo
   * jméno, podpis i fotky bez varování). Nuluje se jen při přechodu na jinou.
   */
  const openForm = (step: WorkflowStep) => {
    if (step.step_id === openStepId) {
      setOpenStepId(null);
      return;
    }
    vycistiFormular();
    setBanner(null);
    setOpenStepId(step.step_id);
  };

  /**
   * Two seams, chosen by whether a signature was given.
   *
   * With one, the completion goes through `submit_evidence_review_audited`: that
   * is where the audit hangs — the journal records the fact and the size of the
   * mark (never the image), and the position is derived server-side instead of
   * being taken from the client. Without one, this is an ordinary node with no
   * evidence to carry, and forcing every step through the evidence path would
   * mean inventing a signature nobody gave.
   *
   * ⭐ A TŘETÍ CESTA: BEZ SIGNÁLU. Milník se potvrzuje na místě, kde se stal —
   * v lomu, u odlehlého odběrného místa — a tam signál nebývá. Potvrzení proto
   * jde do fronty a odešle se samo, až síť je. Bez toho by řidič buď čekal na
   * signál (a potvrzoval z paměti o hodinu později), nebo by mu appka práci
   * odmítla přijmout.
   *
   * `occurredAt` se bere TEĎ, ne při odeslání: je to čas, kdy člověk stiskl
   * potvrzení v terénu. Čas synchronizace je údaj o naší síti, ne o dodávce.
   */
  /**
   * Uloží rozdělanou práci do fronty — JEDEN tvar pro obě cesty, které ji tam
   * ukládají: „nemám signál" (rozhodnuto předem) a „odeslání selhalo"
   * (rozhodnuto až podle příčiny).
   *
   * ⛔ Proč pomocník a ne dvakrát tentýž blok: kdyby si každá cesta skládala
   * payload po svém, rozešly by se v tichosti. Poznalo by se to až tím, že se
   * z fronty odešle něco jiného, než co člověk v terénu vyplnil — tedy ve
   * chvíli, kdy už to nikdo nedokáže zpětně porovnat.
   */
  /**
   * Uložit, koho člověk zapsal. Volá se u OBOU konců cesty (odesláno i zařazeno
   * do fronty) — z pohledu paměti je to táž událost: člověk to jméno potvrdil.
   * Selhání zápisu se polyká: pomůcka nesmí shodit předání.
   */
  const zapamatujPrebirajiciho = async (step: WorkflowStep) => {
    if (!uid || !recipient.trim()) return;
    const dalsi = zapamatuj(pamet, step.input_data, recipient, new Date());
    setPamet(dalsi);
    await AsyncStorage.setItem(klicPrebirajici(uid), JSON.stringify(dalsi)).catch(() => {});
  };

  const zaradPraci = async (step: WorkflowStep, occurredAt: string, poloha?: DevicePositionPayload) => {
    const evidence = Object.entries(photos)
      .filter(([, p]) => p)
      .map(([slot, p]) => ({
        slot, uri: p!.uri, takenAt: p!.takenAt,
        mimeType: p!.mimeType, fileSizeBytes: p!.fileSizeBytes,
      }));

    if (isMeterReadingStep(step)) {
      const id = `meter:${step.step_id}:${occurredAt}`;
      await enqueueMutation(id, {
        mutationId: id,
        stepId: step.step_id,
        occurredAt,
        value: Number(reading.replace(",", ".").trim()),
        suggested,
        note: note.trim() || null,
        photos: evidence,
      }, "submit_meter_reading");
      await refreshQueueSize();
      return;
    }

    const id = `step:${step.step_id}:${occurredAt}`;
    await enqueueMutation(id, {
      mutationId: id,
      stepId: step.step_id,
      occurredAt,
      recipient: recipient.trim() || null,
      // Souhlas je stisk „Souhlasí · k podpisu" (nesouhlas = výhrada v poznámce).
      itemsOk: true,
      note: note.trim() || null,
      hasDeviation: deviation,
      signature,
      photos: evidence,
      // Poloha se měří PŘI POTVRZENÍ, ne při odeslání z fronty — jako `occurredAt`.
      devicePosition: poloha ?? null,
    }, "complete_workflow_step");
    await zapamatujPrebirajiciho(step);
    // ⛔ BEZ TOHOHLE by pruh o nové položce nevěděl až do příští změny sítě —
    // tedy přesně ve chvíli, kdy člověk potřebuje vidět, že se práce uložila.
    await refreshQueueSize();
  };

  const submit = async (step: WorkflowStep) => {
    if (odeslaniBezi.current) return;
    odeslaniBezi.current = true;
    setOdesilam(true);
    try {
      await odesli(step);
    } finally {
      odeslaniBezi.current = false;
      setOdesilam(false);
    }
  };

  const odesli = async (step: WorkflowStep) => {
    const occurredAt = new Date().toISOString();
    // Poloha tabletu k předání (metainformace vedle polohy vozu, viz
    // lib/polohaZarizeni). Deklaruje se tady, aby ji měla i záchranná cesta
    // v `catch` — do fronty musí jít tatáž poloha, jaká patřila k potvrzení.
    let poloha: DevicePositionPayload | undefined;
    try {
      // ── Odečet měřidla ──────────────────────────────────────────────────
      // Hodnota jde SPOLU s potvrzením. Čárka i tečka jsou totéž číslo — na
      // české klávesnici padne spíš čárka a odmítnout ji by bylo buzerování,
      // ne validace. Prázdné nebo nečíselné se ale neodesílá: odečet bez čísla
      // není odečet a tiše dosadit nulu by byl vymyšlený údaj.
      if (isMeterReadingStep(step)) {
        const value = Number(reading.replace(",", ".").trim());
        if (!reading.trim() || !Number.isFinite(value)) {
          rekni("chyba", t("meter.valueRequired"));
          return;
        }

        // Bez signálu do fronty i s odečtem — odběrná místa bývají odlehlá a
        // právě tam síť nebývá. OCR běželo na zařízení, takže hodnotu už máme.
        if (!isConnected) {
          await zaradPraci(step, occurredAt);
          rekni("fronta", t("meter.queuedOffline", { value }));
          setOpenStepId(null);
          return;
        }
        // Foto je DOKLAD NAVÍC, ne podmínka: odečet stojí na hodnotě, kterou
        // člověk potvrdil. Když se snímek nepodaří odeslat (v terénu běžné),
        // odečet se tím NERUŠÍ — jen se uloží bez dokladu a řekne se to.
        // Opačné pořadí (napřed hodnota) by bylo horší: doklad bez odečtu je
        // odpad, kdežto odečet bez dokladu je pořád platný odečet.
        let photoKey: string | null = null;
        let photoFailed = false;
        if (photoCount(photos) > 0) {
          try {
            const [first] = await uploadEvidenceSet(
              { entityKind: "workflow_step", entityId: step.step_id }, photos);
            photoKey = first?.objectKey ?? null;
          } catch {
            photoFailed = true;
          }
        }

        await meterReading.mutateAsync({
          stepId: step.step_id,
          value,
          suggested,
          photoKey,
          note: note.trim() || null,
          occurredAt,
        });
        // Odečet se ULOŽIL i bez fotky — je to varování, ne chyba, a nesmí se tak
        // cítit ani vypadat. Doklad chybí; hodnota, o kterou jde, ne.
        rekni(photoFailed ? "pozor" : "hotovo",
          photoFailed ? t("meter.savedNoPhoto", { value }) : t("meter.saved", { value }));
        setOpenStepId(null);
        return;
      }

      poloha = await zjistiPolohuPredani(nativePolohaDeps());

      if (!isConnected) {
        // Fotky se nesou jako lokální odkazy; nahrají se při přehrání fronty.
        await zaradPraci(step, occurredAt, poloha);
        dokonceno(step, occurredAt, "fronta", t("workflow.steps.queuedOffline", { n: photoCount(photos) }));
        return;
      }

      // Online: NEJDŘÍV evidence, POTOM milník. Opačné pořadí by po pádu uploadu
      // nechalo krok uzavřený bez fotek, které ho mají doložit.
      if (photoCount(photos) > 0) {
        await uploadEvidenceSet({ entityKind: "workflow_step", entityId: step.step_id }, photos);
      }

      const result = signature
        ? await handover.mutateAsync({
            stepId: step.step_id,
            recipient: recipient.trim(),
            signature,
            note: note.trim() || null,
            occurredAt,
            devicePosition: poloha,
            // A declared deviation must stay a deviation: the RPC reads any
            // decision other than the confirming one as exactly that.
            ...(deviation ? { decision: "DEVIATION" } : {}),
          })
        : await complete.mutateAsync({
        stepId: step.step_id,
        outputData: { recipient: recipient.trim() || null, items_ok: true, device_position: poloha ?? null },
        note: note.trim() || null,
        hasDeviation: deviation,
        occurredAt,
      });
      await zapamatujPrebirajiciho(step);
      const r = result.reward;
      const odmena = r?.success && r.amount_awarded ? { amount: r.amount_awarded, token: "ASH" } : null;
      dokonceno(
        step,
        occurredAt,
        "hotovo",
        odmena ? t("workflow.steps.rewarded", odmena) : t("workflow.steps.completed"),
        t("handover.done.sent"),
        odmena,
      );
    } catch (error) {
      /**
       * ⛔ TADY SE ZTRÁCELA PRÁCE ŘIDIČE.
       *
       * Původně tu stálo `catch { setBanner(chyba) }`. Fronta se plnila jen na
       * větvi „nemám signál", takže když měl řidič signál a odeslání přesto
       * selhalo — zamčený edge, výpadek serveru — vyplněné předání (příjemce,
       * podpis, fotky, odchylka) zmizelo a zůstala jen věta „nepodařilo se".
       *
       * Je to TÁŽ třída, kterou opravil PR #154 ve frontě, jen o krok dřív:
       * tam se práce mazala po třech pokusech, tady se do fronty vůbec
       * nedostala. `isConnected` je stav ZAŘÍZENÍ; o tom, jestli nás protistrana
       * přijme, nevypovídá nic.
       *
       * ⭐ Rozhoduje PŘÍČINA, ne fakt selhání:
       *   rejected  — server rozuměl a data odmítl. Do fronty NEPATŘÍ: odeslat
       *               je znovu znamená dostat totéž odmítnutí, jen později.
       *   denied    — odmítl NAŠI IDENTITU (401/403). Práce je platná, vadí
       *               přístup ⇒ uložit a nabídnout zaklepání.
       *   unreachable / transient — kanál, ne data ⇒ uložit, odejde samo.
       *
       * Samotné pravidlo bydlí v `lib/zachranaPrace.ts` — má vlastní jméno
       * a vlastní důkaz, protože rozhoduje o tom, jestli řidiči zmizí hodina
       * práce. Uvnitř `catch` by se nedalo ani vyslovit, ani otestovat.
       */
      const { nabidnoutZaklepani, ulozit } = zachranaPrace(classifyFailure(error));

      if (!ulozit) {
        rekni("chyba", t("workflow.steps.completeError"));
        return;
      }

      try {
        await zaradPraci(step, occurredAt, poloha);
      } catch {
        // Selhal i zápis do fronty — tvrdit „uloženo" by byla lež o datech,
        // která nikde nejsou. Radši neúspěch, který je vidět.
        rekni("chyba", t("workflow.steps.completeError"));
        return;
      }

      setOpenStepId(null);
      if (nabidnoutZaklepani) {
        /*
          ⭐ NEŽ SE OBTĚŽUJE ČLOVĚK, ZKUSÍ TO ZAŘÍZENÍ SAMO (majitel, 9. 9.).
          Appka se nemá jak zeptat, jestli je schválená — dveře mlčí i při
          úspěchu. Zaťuká tedy průkazem zařízení; práce je v tu chvíli UŽ VE
          FRONTĚ, takže odejde sama, jakmile dveře povolí. Teprve když
          automatika není čím udělat (žádný průkaz) nebo neprošla, rozsvítí se
          banner s ruční cestou.

          ⚠️ Když fronta neuspěje ani po zaťukání, banner se odsud nerozsvítí —
          o výsledku fronty tahle obrazovka neví. Není to slepá ulička: ke
          dveřím vede záložka v hlavičce na KAŽDÉ obrazovce (hlídá to brána
          `cestaKeDverim`) a nejbližší další neúspěšné odeslání sem přijde
          znovu, tentokrát už s vyčerpaným automatickým pokusem ⇒ banner.
        */
        const krok = await zkusDvere(false, nativeObsluhaDveri());
        if (krok.krok === "zkus-znovu") {
          dokonceno(step, occurredAt, "fronta", t("workflow.steps.queuedKnocked"));
        } else {
          setZamceno(true);
          // Zamčeno: uloženo, ale samo to nepůjde — čeká se na ČLOVĚKA (zaklepání).
          dokonceno(step, occurredAt, "pozor", t("workflow.steps.queuedLocked"));
        }
      } else {
        dokonceno(step, occurredAt, "fronta", t("workflow.steps.queuedAfterFailure"));
      }
    }
  };

  return (
    /*
      ⛔ KLÁVESNICE ZAKRÝVALA POTVRZENÍ. Při psaní vyjádření se tlačítko schovalo
      pod klávesnici a na iOS ji nic nezavíralo — člověk u kamionu neměl jak
      úkon dokončit. `keyboardShouldPersistTaps` navíc zařídí, že první klepnutí
      na tlačítko ho rovnou stiskne místo toho, aby jen sklidilo klávesnici.
    */
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
    {/*
      MASTER–DETAIL NAD PRAHEM ŠÍŘKY.

      ⭐ Detail zůstává TÝŽ komponent jako na telefonu — nevzniká druhá appka
      (to bylo v UX dokumentu N13 ta obava). Přibývá jen sloupec vlevo, a jen
      tam, kde je na něj místo; pod prahem se nezmění vůbec nic.
    */}
    <View style={obalRozlozeni(dvousloupec)}>
      {dvousloupec && (
        <PaskaKroku
          kroky={doPasky}
          otevrenyId={focused?.step_id ?? openStepId}
          naKrok={(step) => router.setParams({ step: step.step_id })}
          titulek={t("workflow.steps.overline")}
          prazdno={t("workflow.steps.empty")}
        />
      )}
    <ScrollView
      style={styles.container}
      // ⛔ NA TABLETU SE OBSAH NEROZTAHUJE. Karta přes 1280 dp má nadpis vlevo,
      // odměnu u pravého okraje a mezi nimi prázdno; řádek s dokladem je
      // nekonečný. Strop platí jen tam, kde je na něj místo (viz sirkaObsahu).
      // Obrazovka je bez hlavičky, takže výřez displeje a stavový řádek řeší ona sama
      // — pevné odsazení nechávalo nadpis pod nimi (2026-09-29).
      contentContainerStyle={[styles.content, sloupec, { paddingTop: spacing.lg + okraje.top }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={
        <RefreshControl
          refreshing={stepParam ? focusedQuery.isRefetching : steps.isRefetching}
          onRefresh={() => (stepParam ? focusedQuery.refetch() : steps.refetch())}
          tintColor={colors.primary}
        />
      }
      testID="kroky-screen"
    >
      {/*
        Hlavička z JAZYKA, ne z lokálních stylů. Maketa staví čitelnost v kabině
        na hierarchii (overline 10 px → nadpis 26 px display); obrazovka měla
        obojí ploché a slilo se to. `Title` tu hierarchii nese za nás.
      */}
      {/*
        DVEŘE JSOU TU VŽDYCKY — ne až po neúspěšném odeslání.

        ⛔ NAMĚŘENO 2026-09-05 na hlášení od majitele: řidič přihlášený z JINÉ
        SÍTĚ neviděl nic a neměl kde zaťukat. Proč: symbol dveří doplněný
        2026-09-02 bydlí v hlavičce ZÁLOŽEK, jenže tahle obrazovka pod nimi
        není a `_layout.tsx` jí dává `headerShown: false`. Zbývalo jediné
        tlačítko — to v banneru, podmíněné `zamceno`, které se rozsvítí až po
        odmítnutém ODESLÁNÍ. Jenže na cizí síti se nenačte vůbec nic, takže se
        nikdy neodesílá ⇒ banner není ⇒ tlačítko není.

        ⭐ Past ve tvaru kruhu: východ z místnosti byl za dveřmi, které se
        otevírají zevnitř. Podmínka na banneru přitom NENÍ chyba — je psaná
        záměrně („kdo ho vidí denně, přestane ho číst") a zůstává. Chyba byla,
        že to byla JEDINÁ cesta.

        ⭐ Tiché, ne nápadné: táž ikona a táž váha jako v hlavičce záložek,
        vedle nadpisu, ne v hlavní akci. `DoorClosed` — dveře jsou zavřené
        a teprve se na ně klepe.
      */}
      <View style={styles.zahlavi}>
        <View style={{ flex: 1 }}>
          <Es.Overline>{t("workflow.steps.overline")}</Es.Overline>
          <Es.Title>{t("workflow.steps.title")}</Es.Title>
        </View>
        <TouchableOpacity
          onPress={() => router.push("/zaklepat")}
          hitSlop={12}
          testID="kroky-zaklepat-vzdy"
          accessibilityRole="button"
          accessibilityLabel={t("workflow.steps.knockAction")}
        >
          <DoorClosed size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/*
        CO JEŠTĚ NEODEŠLO — trvale, ne jako hláška.

        ⭐ Hláška po odeslání zmizí; fronta zůstane. Právě v tom rozdílu vzniká
        telefonát dispečerovi („odešlo mi to?"), na který nikdo v appce neuměl
        odpovědět. Pruh mlčí, když není co říct, takže se nestane pozadím.
      */}
      <PruhFronty
        isConnected={isConnected}
        isProcessing={isProcessing}
        needsAttention={needsAttention}
        queueSize={queueSize}
        storeUnreadable={storeUnreadable}
        onZkusit={() => { void processQueue(); }}
      />

      {banner && (
        <View testID="kroky-banner" accessibilityLiveRegion="polite">
          {/*
            ⭐ Hláška nese TÓN, ne barvu pozadí. `Banner` kreslí glyf (■ ⚠ ℹ)
            vedle slova, takže stav projde i bez barvy — zákon jazyka 01. Dřív
            to bylo plné barevné pole, tedy jediný kanál: barva.
          */}
          <Es.Banner tone={TON_HLASKY[banner.povaha]}>{banner.text}</Es.Banner>
          {/*
            Nabídka zaklepání se ukazuje JEN po doloženém odmítnutí identity.
            Je to break-glass úkon: ťuká vždycky člověk, nikdy aplikace sama —
            proto tlačítko, a ne automatický pokus na pozadí. A proto se
            nezobrazuje „pro jistotu": kdo ho vidí denně, přestane ho číst.
          */}
          {zamceno && (
            <TouchableOpacity
              style={styles.bannerAction}
              onPress={() => router.push("/zaklepat")}
              testID="kroky-zaklepat"
              accessibilityRole="button"
            >
              <Text style={styles.bannerActionText}>{t("workflow.steps.knockAction")}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/*
        JEDEN OTEVŘENÝ KROK — panel reality.

        Dispečer nedostává pohled „jako řidič" v tom smyslu, že by se za něj
        vydával: dostane krok takový, jaký je, VČETNĚ toho, komu patří a jak
        dopadl. Zápis pak nese pravdu i tak — `complete_workflow_step` ukládá
        toho, kdo doopravdy klikl. Kdyby obrazovka mlčela o cizím vlastnictví,
        rozešla by se evidence s tím, co člověk viděl, když rozhodoval.
      */}
      {stepParam && focusedQuery.isLoading && <Text style={styles.muted}>{t("common.loading")}</Text>}
      {stepParam && !focusedQuery.isLoading && !focused && (
        <View style={styles.notice} testID="krok-nedostupny">
          <Text style={styles.noticeTitle}>{t("workflow.step.notFoundTitle")}</Text>
          <Text style={styles.noticeText}>{t("workflow.step.notFoundHint")}</Text>
        </View>
      )}
      {focused && (() => {
        const vstup = (focused.input_data ?? null) as Record<string, unknown> | null;
        const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
        const odberatel = text(vstup?.counterparty);
        return (
        <View style={styles.detail} testID="krok-realita">
          {/*
            ⛔ CIZÍ KROK SE OZNAMUJE PRVNÍ. Dispečer, který přes `?step=` odbavuje předání
            řidiče, to musí vědět dřív, než cokoli potvrdí — do evidence se zapíše on.
          */}
          {!focused.is_mine ? (
            <View style={styles.detailBanner}>
              <Es.Banner tone="wait">{`${t("workflow.step.dispatchTitle")} — ${t("workflow.step.dispatchHint")}`}</Es.Banner>
            </View>
          ) : null}

          {/*
            HERO DETAILU = TÁŽ KARTA JAKO „TEĎ" NA PÁSCE (bod 4, maketa `StopDetail`).
            Řidič po klepnutí na kartu přistane u téhož tvaru: doklad v rámečku, stav,
            ODBĚRATEL jako nadpis (komu to veze), místo vykládky pod ním. Odečet a kroky
            bez odběratele mají nadpis kroku a popis běhu.

            ⛔ Z makety tu NENÍ okno / odhad příjezdu / „na místě N min", Navigovat ani
            Zavolat (kontakt na stavbě) — bez zdroje dat, kontakt je osobní údaj.
            ⛔ Role a přiřazení jsou údaje PROVOZU: vidí je dispečer, řidiči nic neřeknou.
          */}
          <HeroZastavky
            overline={t("workflow.step.doc")}
            chip={dokladCislo(focused)}
            lampa={{
              state: LAMPA_STAVU[focused.status] ?? "plan",
              label: t(`workflow.steps.status.${focused.status}`),
            }}
            nadpis={odberatel ?? focused.step_name}
            citace={text(vstup?.delivery_address) ?? (odberatel ? null : focused.product_name)}
            testID="krok-hero"
          >
            <View style={styles.detailFakta}>
              <Es.Facts
                facts={[
                  { l: t("workflow.step.due"), v: focused.production_date },
                  ...(focused.is_mine
                    ? []
                    : [{ l: t("workflow.step.role"), v: focused.assigned_role, mono: false, size: "sm" as const }]),
                ]}
              />
            </View>
          </HeroZastavky>

          {nakladADoklad(focused, focused.production_date)}

          <View style={styles.facts}>
            {!focused.is_mine ? (
              <>
                <Es.Fact row label={t("workflow.step.assignedTo")} value={focused.assigned_to} />
                <Es.Fact row label={t("workflow.step.assignedTwin")} value={focused.assigned_twin} />
              </>
            ) : null}
            <Es.Fact
              row
              label={t("workflow.step.completedBy")}
              value={[focused.completed_by_name, focused.completed_at?.slice(0, 10)]
                .filter(Boolean).join(" · ") || null}
            />
            <Es.Fact
              row
              tone="warn"
              label={t("workflow.step.deviationLabel")}
              value={focused.has_deviation ? t("workflow.step.deviationFlag") : null}
            />
            <Es.Fact row label={t("workflow.step.noteLabel")} value={focused.notes} />
          </View>

          {/*
            Tablet v kabině (bez přihlášeného člověka) „moje kroky" nemá — přišel sem
            z Dnešních rozvozů a tam se vrací.
          */}
          <TouchableOpacity
            onPress={() => (kioskBezCloveka && router.canGoBack() ? router.back() : router.replace("/kroky"))}
            testID="krok-zpet"
          >
            <Text style={styles.backLink}>
              {kioskBezCloveka ? t("kiosk.zpet_na_rozvozy") : t("workflow.step.backToMine")}
            </Text>
          </TouchableOpacity>
        </View>
        );
      })()}

      {!stepParam && steps.isLoading && <Text style={styles.muted}>{t("common.loading")}</Text>}
      {!stepParam && steps.isError && (
        <View style={styles.notice}><Text style={styles.noticeText}>{t("workflow.steps.loadError")}</Text></View>
      )}
      {!stepParam && !steps.isLoading && !steps.isError && active.length === 0 && (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>{t("workflow.steps.emptyTitle")}</Text>
          <Text style={styles.noticeText}>{t("workflow.steps.emptyHint")}</Text>
        </View>
      )}

      {active.map((step) => {
        const reward = step.input_data?.reward;
        const open = openStepId === step.step_id;
        // Povaha úkonu se pozná z DAT uzlu, ne ze step_code: uzel, který má
        // subjekt (měřidlo), se odbavuje hodnotou; ostatní předáním.
        const isReading = isMeterReadingStep(step);
        return (
          <View key={step.step_id} style={styles.card} testID={`step-card-${step.step_code ?? step.step_id}`}>
            <TouchableOpacity onPress={() => openForm(step)}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{step.step_name}</Text>
                {reward ? <Text style={styles.rewardChip}>+{reward.amount} ASH</Text> : null}
              </View>
              <Text style={styles.cardMeta}>{podtitulKroku(step)}</Text>
              {step.description ? <Text style={styles.cardDesc}>{step.description}</Text> : null}
            </TouchableOpacity>

            {/*
              ⭐ PŘEDÁNÍ MÁ VLASTNÍ LIST (bod 3, maketa `Handover`): 1 Kontrola → 2 Podpis
              → razítko. Karta nese jen náklad (po rozbalení) a jedno velké tlačítko —
              jako „Předání a podpis" v detailu zastávky makety. Odečet měřidla je jiný
              úkon s vlastním formulářem níž; list by mu nutil podpis, který nemá kdo dát.
            */}
            {open && !isReading && focused?.step_id !== step.step_id ? nakladADoklad(step) : null}
            {!isReading ? (
              <View style={styles.predatObal}>
                <ZkoseneTlacitko
                  text={t("handover.cta.start")}
                  ikona="pero"
                  podklad={colors.surface}
                  onPress={() => otevriPredani(step)}
                  testID="kroky-predat"
                />
              </View>
            ) : null}

            {open && isReading && (
              <View style={styles.form}>
                {/* Otevřený přes `?step=` už kartu nese v hlavičce detailu — podruhé ne. */}
                {focused?.step_id === step.step_id ? null : nakladADoklad(step)}
                {/*
                  ODEČET MĚŘIDLA: hodnota je předvyplněná tím, co appka vyčetla z displeje,
                  a člověk ji POTVRDÍ nebo přepíše. Stroj pomáhá, autoritou je pořizovatel —
                  proto je pole editovatelné a odeslat nejde prázdné.
                */}
                <Text style={styles.label}>{t("meter.value")}</Text>
                <TextInput
                  style={styles.input}
                  value={reading}
                  onChangeText={setReading}
                  placeholder={t("meter.valuePlaceholder")}
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="decimal-pad"
                  testID="kroky-reading"
                />
                {suggested != null && (
                  <Text style={styles.muted}>{t("meter.suggested", { value: suggested })}</Text>
                )}
                {/* Odchylka je páka DISPEČERA u cizího kroku, ne řidiče (majitel). */}
                {focused && !focused.is_mine && (
                  <View style={styles.switchRow}>
                    <Text style={styles.label}>{t("workflow.steps.deviation")}</Text>
                    <Switch value={deviation} onValueChange={setDeviation} testID="kroky-deviation" />
                  </View>
                )}
                <Text style={styles.label}>{t("workflow.steps.note")}</Text>
                <TextInput
                  style={[styles.input, styles.noteInput]}
                  value={note}
                  onChangeText={setNote}
                  placeholder={t("workflow.steps.notePlaceholder")}
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  testID="kroky-note"
                />
                <View style={styles.photosRow}>
                  <EvidencePhotos
                    slots={photoSlots(step.input_data as Json | null)}
                    photos={photos}
                    onChange={onReadingPhotos}
                  />
                </View>
                <TouchableOpacity
                  style={[styles.submit, deviation && styles.submitDeviation, busy && styles.submitDisabled]}
                  disabled={busy}
                  onPress={() => submit(step)}
                  testID="kroky-submit"
                >
                  <Text style={styles.submitText}>
                    {busy
                      ? t("workflow.steps.submitting")
                      : deviation
                        ? t("workflow.steps.submitDeviation")
                        : t("workflow.steps.submit")}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}

      {done.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>{t("workflow.steps.doneSection")}</Text>
          {done.slice(0, 10).map((step) => (
            <View key={step.step_id} style={[styles.card, styles.cardDone]}>
              <Text style={styles.cardTitle}>{step.step_name}</Text>
              <Text style={styles.cardMeta}>
                {[podtitulKroku(step), step.completed_at?.slice(0, 10), t(`workflow.steps.status.${step.status}`)]
                  .filter(Boolean).join(" · ")}
              </Text>
            </View>
          ))}
        </>
      )}
      {/*
        LIST PŘEDÁNÍ — jeden pro celou obrazovku, pro krok v `predavam`. Podpis je
        povinný u VLASTNÍHO kroku; dispečer u cizího ho nemá odkud vzít (viz lib/predani).
      */}
      {predavam ? (() => {
        const chybi = chybiKPotvrzeni({
          podpis: signature,
          jmeno: recipient,
          vyzadovat: !(focused && focused.step_id === predavam.step_id && !focused.is_mine),
        });
        const vstup = (predavam.input_data ?? null) as Record<string, unknown> | null;
        const kam = typeof vstup?.counterparty === "string" && vstup.counterparty.trim()
          ? vstup.counterparty.trim()
          : predavam.step_name;
        return (
          <ListPredani
            visible
            nadpis={t("handover.sheet.title", { kam })}
            doklad={cisloDokladu(predavam)}
            krok={krokPredani}
            onZpet={() => (krokPredani === 1 ? setKrokPredani(0) : setPredavam(null))}
            kontrola={kontrolaPredani(predavam)}
            podpis={podpisPredani(predavam)}
            cta={
              krokPredani === 0
                ? {
                    text: t("handover.cta.agree"),
                    ikona: "sipka",
                    disabled: false,
                    duvod: null,
                    onPress: () => setKrokPredani(1),
                    testID: "predani-dal",
                  }
                : {
                    text: busy
                      ? t("workflow.steps.submitting")
                      : deviation
                        ? t("workflow.steps.submitDeviation")
                        : t("handover.cta.confirm"),
                    ikona: "fajfka",
                    disabled: busy || chybi !== null,
                    duvod: chybi ? t(`handover.missing.${chybi}`) : null,
                    onPress: () => submit(predavam),
                    testID: "kroky-submit",
                  }
            }
            hlaska={banner?.povaha === "chyba" ? banner : null}
            predano={predano}
            onPokracovat={pokracovat}
          />
        );
      })() : null}
    </ScrollView>
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  // ⛔ AKCE POD BANNEREM JE NA POZADÍ OBRAZOVKY (2026-09-29). Kreslila se barvou
  // `background` pro dřívější plný barevný banner — ten nahradil Es.Banner s lemem,
  // takže rámeček i text „Zaklepat“ splynuly s pozadím a tlačítko nebylo vidět.
  // Řádek nadpisu + dveře. `alignItems: flex-start`, aby ikona seděla u
  // OVERLINE, ne uprostřed dvouřádkového nadpisu — jinak se opticky propadne.
  zahlavi: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  bannerAction: {
    marginTop: spacing.sm, alignSelf: "center",
    borderWidth: 1.5, borderColor: colors.primary, borderRadius: 8,
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
    // Dotyková plocha nesmí být menší než palec — banner se čte v autě.
    minHeight: 44, justifyContent: "center",
  },
  bannerActionText: { color: colors.primary, fontWeight: "700", fontSize: 15 },
  notice: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing.lg },
  // Cizí krok se odlišuje LEMEM, ne barvou textu: je to upozornění na kontext,
  // ne na chybu, a stavové barvy (červená/žlutá) tu mají svůj vlastní význam.
  noticeTitle: { color: colors.text, fontSize: 15, fontWeight: "700", marginBottom: spacing.xs },
  noticeText: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  facts: { marginTop: spacing.sm },
  // Hodnota údaje je to, co člověk u rampy porovnává s realitou — největší
  // a nejtučnější text na kartě, ne „meta".
  backLink: { color: colors.primary, fontSize: 15, fontWeight: "700", marginTop: spacing.md, minHeight: 44, lineHeight: 30 },
  muted: { color: colors.textSecondary, fontSize: 14 },
  predatObal: { marginTop: spacing.md },
  detail: { marginBottom: spacing.md },
  detailBanner: { marginBottom: spacing.sm },
  detailFakta: { marginTop: spacing.sm },
  extraHint: { color: colors.textSecondary, fontSize: 13, marginTop: 6, marginBottom: spacing.sm },
  vyhradaTlacitko: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    marginTop: spacing.sm,
  },
  vyhradaText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  vyhradaPata: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  vyhradaHint: { flex: 1, marginTop: 0, marginBottom: 0 },
  odkaz: { color: colors.primary, fontSize: 14, fontWeight: "600", paddingVertical: 8 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing.md, marginBottom: spacing.sm },
  cardDone: { opacity: 0.7 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  rewardChip: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  // Doklad + produkt: podle TÉHLE řádky člověk kartu poznává. 12.5 px na
  // slunci u kamionu není čitelné.
  cardMeta: { color: colors.textSecondary, fontSize: 14, marginTop: 2 },
  cardDesc: { color: colors.textSecondary, fontSize: 14, marginTop: spacing.xs, lineHeight: 20 },
  form: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  label: { color: colors.textSecondary, fontSize: 14, marginBottom: 4 },
  photosRow: { marginTop: spacing.md, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    borderRadius: 8, color: colors.text, padding: spacing.sm, marginBottom: spacing.sm, fontSize: 14,
  },
  noteInput: { minHeight: 60, textAlignVertical: "top" },
  // Rukavice a chlad: Apple HIG chce 44 pt, terén spíš 48. Hero CTA a Potvrdit
  // to měly, okolí ne — a právě okolí se mačká, když se spěchá.
  switchRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginBottom: spacing.sm, minHeight: 48,
  },
  navrh: {
    alignSelf: "flex-start", marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.primary, borderRadius: 8,
    paddingHorizontal: spacing.md, justifyContent: "center", minHeight: 48,
  },
  navrhText: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  // „Podat k podpisu" je krok, po kterém telefon mění majitele — proto je to
  // plnohodnotná akce, ne odkaz.
  podat: {
    borderWidth: 1.5, borderColor: colors.primary, borderRadius: 10,
    minHeight: 52, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm,
  },
  podatText: { color: colors.primary, fontSize: 15, fontWeight: "700" },
  podepsano: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 1, borderColor: colors.success, borderRadius: 10,
    paddingHorizontal: spacing.md, minHeight: 52, marginBottom: spacing.sm,
  },
  podepsanoText: { color: colors.success, fontSize: 15, fontWeight: "700" },
  podepsanoZnovu: { minHeight: 48, justifyContent: "center", paddingLeft: spacing.md },
  podepsanoZnovuText: { color: colors.textSecondary, fontSize: 14, fontWeight: "600" },
  submit: {
    backgroundColor: colors.primary, borderRadius: 10, padding: spacing.md,
    alignItems: "center", justifyContent: "center", minHeight: 52,
  },
  submitDeviation: { backgroundColor: colors.error },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: colors.background, fontWeight: "800", fontSize: 14 },
  sectionTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: "700", marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: "uppercase", letterSpacing: 1 },
});
