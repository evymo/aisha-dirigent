/**
 * TABLET V KABINĚ — zavedení, připojení a Dnešní rozvozy bez přihlášeného člověka.
 *
 * ⭐ Majitel 2026-09-29: „nezjednodušuj, dotáhni to k dokonalosti, ať to můžeme nasadit na
 *    tablety a dát je řidičům"; „po validaci … klepání odemyká … a následně je možnost se
 *    dostat do aplikace bez přihlášení pouze k našim dodákům"; výběr podle řidiče i vozidla.
 *
 * Cesta tabletu (pravidlo v `lib/pruvodceTabletu`):
 *   1. ZAVEDENÍ — jediný lidský úkon: technik zadá kód dveří. Tablet zaťuká, založí si
 *      klíč a sám se ohlásí (dřív tři ruční tlačítka).
 *   2. ČEKÁ NA SCHVÁLENÍ — ukazuje otisk pro správce a ptá se sám každých 30 s.
 *   3. PŘIPOJUJI — schválený tablet si otevře dveře VLASTNÍM průkazem (UDP, z jakékoli
 *      adresy) a vezme si relaci svého účtu; neúspěch = další pokus s odstupem.
 *   4. DNEŠNÍ ROZVOZY — tatáž páska jako na telefonu; CTA „Předání a podpis" otevře list
 *      předání, po razítku „Pokračovat" vrátí sem.
 *
 * ⛔ Dveře NEPODMÍNĚNĚ (brána cestaKeDverim): obrazovka je bez hlavičky záložek, takže
 *    symbol dveří nese sama — v KAŽDÉM stavu, ne až po chybě.
 * ⛔ Obrazovka nezhasne (`useKeepAwake`): tablet v kabině nikdo neodemyká a zhasnutý
 *    displej u rampy je stojící předání.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { DoorClosed } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { useKeepAwake } from "expo-keep-awake";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/config/api";
import { resolveKnockTarget } from "@/config/knock";
import { useTranslation } from "@/hooks";
import { Es } from "@/extranet/esdk";
import { PaskaDne } from "@/extranet/PaskaDne";
import { ZkoseneTlacitko } from "@/components/ZkoseneTlacitko";
import { zdrojZarizeni } from "@/lib/identitaZarizeni";
import { knockWithCode } from "@/lib/knock";
import { nativeKnockDeps, nativeTabletDeps, nativeZarizeni } from "@/lib/knock-native";
import { nativeSamoKlepaniDeps } from "@/lib/obsluhaDveri-native";
import { ohlasTablet, zjistiStavTabletu, type VysledekTabletu } from "@/lib/ohlaseniTabletu";
import { koloHlidky, novaPametKiosku } from "@/lib/samoKlepaniKiosku";
import type { VysledekRelace } from "@/lib/relaceTabletu";
import {
  dalsiPokusZa, krokTabletu, zavedTablet, type KrokTabletu, type StavKlice,
} from "@/lib/pruvodceTabletu";
import {
  KLIC_VYBERU, dnesniDen, naPasku, rozlozNabidku, rozlozRozvozy, zParsujVyber, type RezimVyberu,
} from "@/lib/kioskRozvozy";

type Tema = ReturnType<typeof Es.useEsdk>;

type KioskRpc = (fn: "get_kiosk_rozvozy", args: { p_rezim?: RezimVyberu | null; p_hodnota?: string | null }) =>
  Promise<{ data: unknown; error: unknown }>;
const kioskRpc = api.rpc as unknown as KioskRpc;

/** Jak často se nabídka obnovuje sama (nové dodáky během dne, předání z jiného tabletu). */
const OBNOVA_MS = 60_000;

async function nacti(args: { p_rezim?: RezimVyberu | null; p_hodnota?: string | null }): Promise<unknown> {
  const { data, error } = await kioskRpc("get_kiosk_rozvozy", args);
  if (error) throw error instanceof Error ? error : new Error(String((error as { message?: unknown })?.message ?? error));
  return data;
}

/** Verze appky, kterou tablet hlásí při ohlášení (správce ji vidí u průkazu). */
function verzeAppky(): { ridic: string } {
  const android = Constants.expoConfig?.android?.versionCode;
  return { ridic: `${Constants.expoConfig?.version ?? "?"}${android ? ` (${android})` : ""}` };
}

export default function KioskScreen() {
  useKeepAwake();
  const { t } = useTranslation();
  const tema = Es.useEsdk();
  const s = styly(tema);
  const okraje = useSafeAreaInsets();

  const [klic, setKlic] = useState<StavKlice>("nevim");
  const [otisk, setOtisk] = useState<{ kid: string; verejny: string } | null>(null);
  const [prukaz, setPrukaz] = useState<VysledekTabletu | null>(null);
  const [relace, setRelace] = useState<VysledekRelace | null>(null);
  /** Každé dokončené kolo průvodce — spouští plánování dalšího. */
  const [kolo, setKolo] = useState(0);
  const [zaSekund, setZaSekund] = useState<number | null>(null);
  const pametHlidky = useRef(novaPametKiosku());
  const pokus = useRef({ krok: "", n: 0 });
  const bezi = useRef(false);

  const nactiKlic = useCallback(async () => {
    try {
      const p = await nativeZarizeni().nacti();
      setKlic(p ? "ma" : "nema");
      setOtisk(p ? { kid: p.kid, verejny: p.publicKeyHex } : null);
      return p;
    } catch {
      // Nečitelný záznam se UKÁŽE (vadny-klic), nespolkne — tichá výměna klíče je
      // k nerozeznání od útoku (viz poverovani-zarizeni).
      setKlic("vadny");
      return null;
    }
  }, []);

  /**
   * JEDNO KOLO PRŮVODCE: relace (nejsilnější důkaz) → stav průkazu (bez dveří) → u
   * schváleného tabletu zaťukat vlastním průkazem a zkusit relaci znovu.
   */
  const obnov = useCallback(async () => {
    if (bezi.current) return;
    bezi.current = true;
    try {
      const p = await nactiKlic();
      if (!p) return;
      const zdroj = zdrojZarizeni();
      let r: VysledekRelace | null = null;
      if (zdroj) {
        await zdroj.token();
        r = zdroj.posledni();
      }
      if (r?.stav === "ok") {
        setRelace(r);
        return;
      }
      const stav = await zjistiStavTabletu(p, nativeTabletDeps()).catch(
        (e: unknown): VysledekTabletu => ({ stav: "selhalo", duvod: e instanceof Error ? e.message : String(e) }),
      );
      setPrukaz(stav);
      if (stav.stav === "schvaleno" && zdroj) {
        await koloHlidky(pametHlidky.current, nativeSamoKlepaniDeps()).catch(() => undefined);
        await zdroj.token();
        r = zdroj.posledni();
      }
      setRelace(r);
    } finally {
      bezi.current = false;
      setKolo((k) => k + 1);
    }
  }, [nactiKlic]);

  // Návrat z předání (nebo ze servisu) = nové kolo: relace mohla mezitím vypršet.
  useFocusEffect(
    useCallback(() => {
      void obnov();
    }, [obnov]),
  );

  // Stabilní objekt kroku: plánovač níž se má přeplánovat jen při změně vstupů, ne při každém vykreslení.
  const krok = useMemo(() => krokTabletu({ klic, prukaz, relace }), [klic, prukaz, relace]);

  // Plánování dalšího samostatného pokusu + odpočet pro oči.
  useEffect(() => {
    if (pokus.current.krok === krok.krok) pokus.current.n += 1;
    else pokus.current = { krok: krok.krok, n: 0 };
    const za = dalsiPokusZa(krok, pokus.current.n);
    if (za == null) {
      setZaSekund(null);
      return undefined;
    }
    const konec = Date.now() + za;
    setZaSekund(Math.ceil(za / 1000));
    const odpocet = setInterval(() => setZaSekund(Math.max(0, Math.ceil((konec - Date.now()) / 1000))), 1_000);
    const dalsi = setTimeout(() => void obnov(), za);
    return () => {
      clearInterval(odpocet);
      clearTimeout(dalsi);
    };
    // Plánuje se po každém kole (`kolo`) a při změně kroku.
  }, [kolo, krok, obnov]);

  const zkusitHned = useCallback(() => {
    pokus.current = { krok: "", n: 0 };
    void obnov();
  }, [obnov]);

  return (
    <View style={[s.koren, { paddingTop: okraje.top, paddingBottom: okraje.bottom }]} testID="kiosk">
      <View style={s.zahlavi}>
        <View style={s.zahlaviText}>
          <Text style={s.overline}>{dnesniDen()}</Text>
          <Text style={s.nadpis}>{krok.krok === "hotovo" ? t("kiosk.title") : t("kiosk.tablet")}</Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push("/zaklepat")}
          hitSlop={12}
          testID="kiosk-zaklepat-vzdy"
          accessibilityRole="button"
          accessibilityLabel={t("workflow.steps.knockAction")}
        >
          <DoorClosed size={26} color={tema.muted} />
        </TouchableOpacity>
      </View>

      {krok.krok === "hotovo" ? (
        <Rozvozy tema={tema} onPorucha={zkusitHned} />
      ) : (
        <ScrollView contentContainerStyle={s.pruvodce} keyboardShouldPersistTaps="handled">
          <Pruvodce
            tema={tema}
            krok={krok}
            otisk={otisk}
            zaSekund={zaSekund}
            onZkusitHned={zkusitHned}
            onZavedeno={(v) => {
              if (v) setPrukaz(v);
              zkusitHned();
            }}
          />
        </ScrollView>
      )}

      <TouchableOpacity onPress={() => router.push("/(auth)/login")} testID="kiosk-prihlasit" style={s.servis}>
        <Text style={s.odkaz}>{t("kiosk.prihlasit")}</Text>
      </TouchableOpacity>
    </View>
  );
}

/** Stav cesty tabletu — slovo, lampa a co se děje dál. */
function Pruvodce({
  tema,
  krok,
  otisk,
  zaSekund,
  onZkusitHned,
  onZavedeno,
}: {
  tema: Tema;
  krok: KrokTabletu;
  otisk: { kid: string; verejny: string } | null;
  zaSekund: number | null;
  onZkusitHned: () => void;
  onZavedeno: (prukaz: VysledekTabletu | null) => void;
}) {
  const { t } = useTranslation();
  const s = styly(tema);
  const odpocet =
    zaSekund != null ? (
      <View style={s.odpocet}>
        <Text style={s.popis}>{t("kiosk.znovu_za", { s: zaSekund })}</Text>
        <TouchableOpacity onPress={onZkusitHned} accessibilityRole="button" testID="kiosk-zkusit-hned">
          <Text style={s.akceOdkaz}>{t("kiosk.zkusit_hned")}</Text>
        </TouchableOpacity>
      </View>
    ) : null;

  switch (krok.krok) {
    case "nacitam":
      return (
        <Es.Card>
          <View style={s.radek}>
            <ActivityIndicator color={tema.primary} />
            <Text style={s.popis}>{t("kiosk.pruvodce_nacitam")}</Text>
          </View>
        </Es.Card>
      );
    case "zavedeni":
      return <Zavedeni tema={tema} proc={krok.proc} onZavedeno={onZavedeno} />;
    case "ceka":
      return (
        <Es.Card>
          <Es.Lamp state="wait" label={t("kiosk.ceka_nadpis")} />
          <Text style={s.text}>{t("kiosk.ceka_text")}</Text>
          <Text style={s.overlineOdsazeny}>{t("knock.device_fingerprint")}</Text>
          <Text style={s.otisk} selectable testID="kiosk-otisk">{krok.kid}</Text>
          {otisk ? <Text style={s.verejny} selectable>{otisk.verejny}</Text> : null}
          {odpocet}
        </Es.Card>
      );
    case "pripojuji":
      return (
        <Es.Card>
          <Es.Lamp state="work" label={t("kiosk.pripojuji_nadpis")} />
          <Text style={s.text}>{t("kiosk.pripojuji_text")}</Text>
          {odpocet}
        </Es.Card>
      );
    case "odvolano":
      return (
        <Es.Card>
          <Es.Lamp state="fault" label={t("kiosk.odvolano_nadpis")} />
          <Text style={s.text}>{t("kiosk.odvolano_text")}</Text>
          {odpocet}
        </Es.Card>
      );
    case "vyprselo":
      return (
        <Es.Card>
          <Es.Lamp state="wait" label={t("kiosk.vyprselo_nadpis")} />
          <Text style={s.text}>{t("kiosk.vyprselo_text")}</Text>
          {odpocet}
        </Es.Card>
      );
    case "vadny-klic":
      return (
        <Es.Card>
          <Es.Lamp state="fault" label={t("kiosk.vadny_nadpis")} />
          <Text style={s.text}>{t("kiosk.vadny_text")}</Text>
        </Es.Card>
      );
    case "porucha":
      return (
        <Es.Card>
          <Es.Lamp state="wait" label={t("kiosk.porucha_nadpis")} />
          <Text style={s.text} testID="kiosk-porucha-duvod">{krok.duvod}</Text>
          {odpocet}
        </Es.Card>
      );
    default:
      return null;
  }
}

/**
 * ZAVEDENÍ — jediný lidský úkon: kód technika. Zaťukat, založit klíč, ohlásit se —
 * pořadí a opakování drží `zavedTablet`, obrazovka jen říká, co se děje.
 */
function Zavedeni({
  tema,
  proc,
  onZavedeno,
}: {
  tema: Tema;
  proc: "bez-klice" | "nezname";
  onZavedeno: (prukaz: VysledekTabletu | null) => void;
}) {
  const { t } = useTranslation();
  const s = styly(tema);
  const [kod, setKod] = useState("");
  const [bezi, setBezi] = useState(false);
  const [hlaska, setHlaska] = useState<{ tone: "wait" | "fault"; text: string } | null>(null);
  const { target } = resolveKnockTarget();

  const zavest = async () => {
    if (!target || !kod || bezi) return;
    setBezi(true);
    setHlaska(null);
    const v = await zavedTablet(kod, {
      zatukejKodem: (k) => knockWithCode(k, target, nativeKnockDeps()),
      pockej: (ms) => new Promise((r) => setTimeout(r, ms)),
      maKlic: async () => (await nativeZarizeni().nacti()) !== null,
      zalozKlic: async () => {
        await nativeZarizeni().zaved(target.scope);
      },
      ohlas: async () => {
        const p = await nativeZarizeni().nacti();
        if (!p) throw new Error("klíč tabletu nevznikl");
        return ohlasTablet(p, verzeAppky(), nativeTabletDeps());
      },
    });
    // Kód pryč hned, jak posloužil — ať nevisí v paměti déle, než je nutné.
    setKod("");
    setBezi(false);
    if (v.vysledek === "ohlaseno") {
      onZavedeno(v.prukaz);
      return;
    }
    if (v.vysledek === "dvere-zavrene") setHlaska({ tone: "wait", text: t("kiosk.zavedeni_dvere") });
    else if (v.vysledek === "neodeslano") setHlaska({ tone: "fault", text: t("kiosk.zavedeni_neodeslano", { duvod: v.duvod }) });
    else setHlaska({ tone: "fault", text: t("kiosk.zavedeni_chyba", { duvod: v.duvod }) });
    onZavedeno(null);
  };

  return (
    <Es.Card>
      <Text style={s.overline}>{t("kiosk.zavedeni_nadpis")}</Text>
      {proc === "nezname" ? <Text style={s.text}>{t("kiosk.zavedeni_nezname")}</Text> : null}
      {[1, 2, 3].map((n) => (
        <View key={n} style={s.krokZavedeni}>
          <Text style={s.cisloKroku}>{n}</Text>
          <Text style={s.textKroku}>{t(`kiosk.zavedeni_krok${n}`)}</Text>
        </View>
      ))}
      {target ? (
        <>
          <TextInput
            accessibilityLabel={t("kiosk.zavedeni_kod")}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            editable={!bezi}
            onChangeText={setKod}
            placeholder={t("kiosk.zavedeni_kod")}
            placeholderTextColor={tema.muted}
            secureTextEntry
            style={s.pole}
            testID="kiosk-kod"
            value={kod}
          />
          <ZkoseneTlacitko
            text={bezi ? t("kiosk.zavedeni_bezi") : t("kiosk.zavedeni_akce")}
            ikona="sipka"
            ikonaZa
            disabled={bezi || kod.length === 0}
            onPress={() => void zavest()}
            testID="kiosk-zavest"
          />
        </>
      ) : (
        <Text style={s.text} testID="kiosk-nenastaveno">{t("kiosk.zavedeni_nenastaveno")}</Text>
      )}
      {hlaska ? (
        <View style={s.hlaska} accessibilityLiveRegion="polite" testID="kiosk-zavedeni-hlaska">
          <Es.Banner tone={hlaska.tone}>{hlaska.text}</Es.Banner>
        </View>
      ) : null}
    </Es.Card>
  );
}

/**
 * DNEŠNÍ ROZVOZY — výběr podle řidiče nebo vozidla, pod ním táž páska jako na telefonu.
 * Výběr přežije restart (ne půlnoc); obnovuje se sám a po návratu z předání.
 */
function Rozvozy({ tema, onPorucha }: { tema: Tema; onPorucha: () => void }) {
  const { t } = useTranslation();
  const s = styly(tema);
  const [rezim, setRezim] = useState<RezimVyberu>("ridic");
  const [vybrano, setVybrano] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KLIC_VYBERU)
      .then((j) => {
        const v = zParsujVyber(j, dnesniDen());
        if (v) {
          setRezim(v.rezim);
          setVybrano(v.hodnota);
        }
      })
      .catch(() => undefined);
  }, []);

  const vyber = (r: RezimVyberu, hodnota: string | null) => {
    setRezim(r);
    setVybrano(hodnota);
    if (hodnota) {
      AsyncStorage.setItem(KLIC_VYBERU, JSON.stringify({ den: dnesniDen(), rezim: r, hodnota })).catch(() => undefined);
    }
  };

  const nabidka = useQuery({
    queryFn: async () => rozlozNabidku(await nacti({})),
    queryKey: ["kiosk-nabidka"],
    refetchInterval: OBNOVA_MS,
  });
  const rozvozy = useQuery({
    enabled: vybrano !== null,
    queryFn: async () => rozlozRozvozy(await nacti({ p_rezim: rezim, p_hodnota: vybrano })),
    queryKey: ["kiosk-rozvozy", rezim, vybrano],
    refetchInterval: OBNOVA_MS,
  });

  // Selhání dat po připojení (relace vypršela, dveře se zavřely po změně adresy)
  // vrací tablet do průvodce, ne do prázdného seznamu.
  const selhalo = nabidka.isError || rozvozy.isError;
  useEffect(() => {
    if (selhalo) onPorucha();
  }, [selhalo, onPorucha]);

  const obnovNabidku = nabidka.refetch;
  const obnovRozvozy = rozvozy.refetch;
  useFocusEffect(
    useCallback(() => {
      void obnovNabidku();
      if (vybrano) void obnovRozvozy();
    }, [obnovNabidku, obnovRozvozy, vybrano]),
  );

  const polozky = (rezim === "ridic" ? nabidka.data?.ridici : nabidka.data?.vozidla) ?? [];
  const pasek = naPasku(rozvozy.data ?? [], rezim);
  const hlaskaChyby = selhalo ? (
    <View accessibilityLiveRegion="polite" testID="kiosk-rozvozy-chyba">
      <Es.Banner tone="wait">{t("kiosk.rozvozy_chyba")}</Es.Banner>
    </View>
  ) : null;

  return (
    <ScrollView
      contentContainerStyle={s.rozvozy}
      refreshControl={
        <RefreshControl
          refreshing={nabidka.isFetching || rozvozy.isFetching}
          onRefresh={() => {
            void obnovNabidku();
            if (vybrano) void obnovRozvozy();
          }}
        />
      }
      testID="kiosk-screen"
    >
      {hlaskaChyby}
      <View style={s.zalozky} accessibilityRole="tablist">
        {(["ridic", "vozidlo"] as const).map((r) => (
          <TouchableOpacity
            key={r}
            onPress={() => vyber(r, null)}
            style={[s.zalozka, rezim === r && s.zalozkaAktivni]}
            accessibilityRole="tab"
            accessibilityState={{ selected: rezim === r }}
            testID={`kiosk-rezim-${r}`}
          >
            <Text style={[s.zalozkaText, rezim === r && s.zalozkaTextAktivni]}>
              {t(r === "ridic" ? "kiosk.podle_ridice" : "kiosk.podle_vozidla")}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={s.volby}>
        {polozky.length === 0 && !nabidka.isLoading ? (
          <Text style={s.popis} testID="kiosk-prazdne">{t("kiosk.prazdne")}</Text>
        ) : null}
        {polozky.map((p) => (
          <TouchableOpacity
            key={p.hodnota}
            onPress={() => vyber(rezim, p.hodnota)}
            style={[s.volba, vybrano === p.hodnota && s.volbaAktivni]}
            accessibilityRole="button"
            accessibilityState={{ selected: vybrano === p.hodnota }}
            testID={`kiosk-volba-${p.hodnota}`}
          >
            <Text style={s.volbaText}>{p.hodnota}</Text>
            <Text style={s.volbaPocet}>
              {t("kiosk.k_predani", { pocet: p.kPredani })}
              {p.hotovo ? ` · ${t("kiosk.hotovo", { pocet: p.hotovo })}` : ""}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {vybrano === null ? (
        polozky.length > 0 ? <Text style={s.popis}>{t("kiosk.vyber")}</Text> : null
      ) : (
        <PaskaDne
          items={pasek}
          entityKind="workflow_step"
          otevri={(id) => router.push({ pathname: "/kroky", params: { step: id } })}
          otevriAkci={(id) => router.push({ pathname: "/kroky", params: { step: id, akce: "predat" } })}
          rowCap={50}
        />
      )}
    </ScrollView>
  );
}

function styly(t: Tema) {
  const mono = { fontFamily: t.fonts.mono, fontVariant: ["tabular-nums" as const] };
  return StyleSheet.create({
    koren: { flex: 1, backgroundColor: t.bg },
    zahlavi: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.spacing.s3,
      paddingHorizontal: t.spacing.s5,
      paddingVertical: t.spacing.s3,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
      backgroundColor: t.surface,
    },
    zahlaviText: { flex: 1 },
    overline: {
      fontSize: 10,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: t.muted,
      fontFamily: t.fonts.sans,
    },
    overlineOdsazeny: {
      fontSize: 10,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: t.muted,
      fontFamily: t.fonts.sans,
      marginTop: t.spacing.s4,
    },
    nadpis: {
      fontFamily: t.fonts.display,
      fontWeight: "800",
      fontStyle: "italic",
      fontSize: 24,
      textTransform: "uppercase",
      color: t.strong,
    },
    pruvodce: { padding: t.spacing.s5, gap: t.spacing.s4 },
    radek: { flexDirection: "row", alignItems: "center", gap: t.spacing.s3 },
    text: { color: t.text, fontSize: 16, lineHeight: 23, marginTop: t.spacing.s3, fontFamily: t.fonts.sans },
    popis: { color: t.muted, fontSize: 14, fontFamily: t.fonts.sans },
    otisk: { ...mono, color: t.strong, fontSize: 22, fontWeight: "700", marginTop: t.spacing.s2 },
    verejny: { ...mono, color: t.muted, fontSize: 13, marginTop: t.spacing.s2 },
    odpocet: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: t.spacing.s4,
      gap: t.spacing.s3,
    },
    akceOdkaz: { color: t.primary, fontSize: 15, fontWeight: "600", paddingVertical: 8, fontFamily: t.fonts.sans },
    krokZavedeni: { flexDirection: "row", gap: t.spacing.s3, marginTop: t.spacing.s3, alignItems: "flex-start" },
    cisloKroku: { ...mono, color: t.primary, fontSize: 15, fontWeight: "700", width: 20 },
    textKroku: { flex: 1, color: t.text, fontSize: 15, lineHeight: 21, fontFamily: t.fonts.sans },
    pole: {
      marginTop: t.spacing.s5,
      marginBottom: t.spacing.s3,
      minHeight: 52,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: t.radii.sm,
      backgroundColor: t.raised,
      color: t.strong,
      fontSize: 18,
      paddingHorizontal: t.spacing.s4,
      fontFamily: t.fonts.sans,
    },
    hlaska: { marginTop: t.spacing.s3 },
    rozvozy: { padding: t.spacing.s5, gap: t.spacing.s3 },
    zalozky: { flexDirection: "row", gap: t.spacing.s2 },
    zalozka: {
      flex: 1,
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: t.radii.sm,
      backgroundColor: t.surface,
    },
    zalozkaAktivni: { borderColor: t.primary, backgroundColor: t.raised },
    zalozkaText: { color: t.muted, fontSize: 15, fontWeight: "600", fontFamily: t.fonts.sans },
    zalozkaTextAktivni: { color: t.strong },
    volby: { flexDirection: "row", flexWrap: "wrap", gap: t.spacing.s2 },
    volba: {
      minWidth: 170,
      paddingVertical: t.spacing.s3,
      paddingHorizontal: t.spacing.s4,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: t.radii.sm,
      backgroundColor: t.surface,
    },
    volbaAktivni: { borderColor: t.primary, borderWidth: 2 },
    volbaText: { color: t.strong, fontSize: 17, fontWeight: "700", fontFamily: t.fonts.sans },
    volbaPocet: { ...mono, color: t.muted, fontSize: 13, marginTop: 2 },
    servis: { alignItems: "center", paddingVertical: t.spacing.s3 },
    odkaz: { color: t.muted, fontSize: 14, textDecorationLine: "underline", fontFamily: t.fonts.sans },
  });
}
