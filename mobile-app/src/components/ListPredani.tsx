/**
 * List předání — dva kroky (Kontrola → Podpis) a razítko „Předáno" (bod 3 vizuálu).
 *
 * Tvar z makety (`driver-handover.jsx`, `Handover` + `driver.css` .sheet/.steps/.foot/
 * .done): hlavička se „Zpět" a dokladem, pruh kroků, posuvný obsah, pata s jedním
 * velkým tlačítkem — a pod ním věta, PROČ ho nejde stisknout.
 *
 * ⭐ LIST JE JEN TVAR. Co je v krocích (karta nákladu, fotky, výhrada, jméno, podpis)
 *    i co se odešle, drží `app/kroky.tsx` — tam žije fronta bez signálu, auditovaná
 *    evidence podpisu i poloha. Druhá kopie odesílání by se rozešla v tom
 *    nejhorším místě: v právním důkazu předání.
 *
 * ⛔ HLÁŠKA MUSÍ BÝT VIDĚT I TADY. List je `Modal` a banner obrazovky kroků je POD
 *    ním — chyba odeslání by jinak zůstala schovaná za listem a řidič by mačkal
 *    tlačítko, které „nic nedělá".
 *
 * ⛔ ODMĚNA JEN NA RAZÍTKU a jen tu, kterou server PŘIZNAL (`amount_awarded`).
 *    Na podpisové straně nic (majitel 20. 8.: přebírající drží telefon a odměna
 *    řidiče se ho netýká); u uložení do fronty ji ještě nikdo nepřiznal.
 */
import { useEffect, useRef, type ReactNode } from "react";
import {
  AccessibilityInfo, Animated, Easing, KeyboardAvoidingView, Modal, Platform,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, ChevronLeft } from "lucide-react-native";
import { Es } from "@/extranet/esdk";
import { useTranslation } from "@/hooks/useTranslation";
import type { Povaha } from "@/lib/odezva";
import { ZkoseneTlacitko } from "./ZkoseneTlacitko";

type Tema = ReturnType<typeof Es.useEsdk>;

/** Co ukáže razítko — skládá `kroky.tsx` z toho, co se právě potvrdilo. */
export interface PredanoStav {
  doklad: string | null;
  /** Čas stisku „Potvrdit předání" (HH:MM), ne čas odeslání. */
  cas: string;
  prebirajici: string | null;
  povaha: Povaha;
  /** Věta o tom, kde práce je: odeslaná, nebo uložená v telefonu. */
  zprava: string;
  /** Jen přiznaná serverem; `null` = nekreslit. */
  odmena: { amount: number; token: string } | null;
  /** Co se zapsalo — prázdné hodnoty se nekreslí (JAZYK-03). */
  radky: { label: string; value: string | null }[];
  dalsi: { nadpis: string; podnadpis: string | null } | null;
}

const LAMPA_POVAHY: Record<Povaha, "ok" | "wait" | "fault"> = {
  hotovo: "ok",
  fronta: "wait",
  pozor: "wait",
  chyba: "fault",
};
const TON_POVAHY: Record<Povaha, "ok" | "info" | "wait" | "fault"> = {
  hotovo: "ok",
  fronta: "info",
  pozor: "wait",
  chyba: "fault",
};

/**
 * Razítko „Předáno" — dopadne jako razítko (zvětšené → přes → na místo), pootočené.
 * ⛔ „Omezit pohyb" v systému = žádná animace, razítko prostě je.
 */
function Razitko({ tema }: { tema: Tema }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let zruseno = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((omezit) => {
        if (zruseno) return;
        if (omezit) {
          a.setValue(1);
          return;
        }
        Animated.timing(a, { toValue: 1, duration: 500, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }).start();
      })
      .catch(() => a.setValue(1));
    return () => {
      zruseno = true;
    };
  }, [a]);
  const scale = a.interpolate({ inputRange: [0, 1], outputRange: [1.7, 1] });
  const opacity = a.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] });
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.razitko,
        {
          backgroundColor: sAlfou(tema.okDot, 0.16),
          borderColor: sAlfou(tema.okDot, 0.55),
          opacity,
          transform: [{ rotate: "-5deg" }, { scale }],
        },
      ]}
    >
      <Check size={30} color={tema.ok} strokeWidth={2.4} />
    </Animated.View>
  );
}

function sAlfou(hex: string, alfa: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alfa})`;
}

function Predano({ stav, onPokracovat }: { stav: PredanoStav; onPokracovat: () => void }) {
  const { t } = useTranslation();
  const tema = Es.useEsdk();
  const s = styly(tema);
  const radky = stav.radky.filter((r) => r.value);
  return (
    <>
      <ScrollView contentContainerStyle={s.obsah} testID="predano">
        <View style={s.hotovo} accessibilityLiveRegion="polite">
          <Razitko tema={tema} />
          <Text style={s.hotovoNadpis} accessibilityRole="header">{t("handover.done.title")}</Text>
          <Text style={s.hotovoPod}>{[stav.doklad, stav.cas, stav.prebirajici].filter(Boolean).join(" · ")}</Text>
          {stav.odmena ? (
            <View style={s.zisk} testID="predano-odmena">
              <Text style={s.ziskPlus}>+</Text>
              <Text style={s.ziskCislo}>{stav.odmena.amount}</Text>
              <Text style={s.ziskJednotka}>{stav.odmena.token}</Text>
            </View>
          ) : null}
        </View>

        <Es.Card tight>
          <Es.Lamp state={LAMPA_POVAHY[stav.povaha]} label={stav.zprava} />
          {radky.length ? (
            <View style={s.radky}>
              {radky.map((r) => (
                <Es.Fact key={r.label} row label={r.label} value={r.value} />
              ))}
            </View>
          ) : null}
        </Es.Card>

        {stav.dalsi ? (
          <View style={s.dalsi}>
            <Es.Card tight>
              <Es.Overline>{t("handover.done.next")}</Es.Overline>
              <Text style={s.dalsiNadpis} numberOfLines={2}>{stav.dalsi.nadpis}</Text>
              {stav.dalsi.podnadpis ? (
                <Text style={s.dalsiPod} numberOfLines={2}>{stav.dalsi.podnadpis}</Text>
              ) : null}
            </Es.Card>
          </View>
        ) : null}
      </ScrollView>
      <View style={s.pata}>
        <ZkoseneTlacitko
          text={t("handover.done.continue")}
          ikona="sipka"
          ikonaZa
          podklad={tema.surface}
          onPress={onPokracovat}
          testID="predano-pokracovat"
        />
      </View>
    </>
  );
}

export function ListPredani({
  visible,
  nadpis,
  doklad,
  krok,
  onZpet,
  kontrola,
  podpis,
  cta,
  hlaska,
  predano,
  onPokracovat,
}: {
  visible: boolean;
  nadpis: string;
  doklad: string | null;
  krok: 0 | 1;
  /** Krok 2 → zpět na kontrolu, krok 1 → zavřít list (i systémové „zpět"). */
  onZpet: () => void;
  kontrola: ReactNode;
  podpis: ReactNode;
  cta: { text: string; ikona: "sipka" | "fajfka"; disabled: boolean; duvod: string | null; onPress: () => void; testID: string };
  hlaska: { text: string; povaha: Povaha } | null;
  predano: PredanoStav | null;
  onPokracovat: () => void;
}) {
  const { t } = useTranslation();
  const tema = Es.useEsdk();
  const s = styly(tema);
  const okraje = useSafeAreaInsets();
  const kroky = [t("handover.step.check"), t("handover.step.sign")];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={predano ? onPokracovat : onZpet}>
      <View style={[s.list, { paddingTop: okraje.top, paddingBottom: okraje.bottom }]} testID="predani-list">
        {predano ? (
          <Predano stav={predano} onPokracovat={onPokracovat} />
        ) : (
          <KeyboardAvoidingView style={s.list} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={s.hlavicka}>
              <TouchableOpacity style={s.zpet} onPress={onZpet} accessibilityRole="button" testID="predani-zpet">
                <ChevronLeft size={18} color={tema.muted} />
                <Text style={s.zpetText}>{t("handover.sheet.back")}</Text>
              </TouchableOpacity>
              <View style={s.kdo}>
                <Text style={s.kdoNadpis} numberOfLines={1}>{nadpis}</Text>
                {doklad ? <Text style={s.kdoDoklad} numberOfLines={1}>{doklad}</Text> : null}
              </View>
            </View>

            {/* Pruh kroků: aktivní primární, hotový zelený — barva i číslo, ne barva sama. */}
            <View style={s.kroky} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: 2, now: krok + 1 }}>
              {kroky.map((nazev, i) => {
                const stavKroku = i === krok ? "on" : i < krok ? "dn" : "";
                return (
                  <View
                    key={nazev}
                    style={[
                      s.krok,
                      stavKroku === "on" && { borderTopColor: tema.primary },
                      stavKroku === "dn" && { borderTopColor: tema.okDot },
                    ]}
                    testID={`predani-krok-${i + 1}`}
                  >
                    <Text
                      style={[
                        s.krokText,
                        stavKroku === "on" && { color: tema.primary },
                        stavKroku === "dn" && { color: tema.ok },
                      ]}
                    >
                      {stavKroku === "dn" ? "✓" : i + 1} {nazev}
                    </Text>
                  </View>
                );
              })}
            </View>

            <ScrollView contentContainerStyle={s.obsah} keyboardShouldPersistTaps="handled">
              {krok === 0 ? kontrola : podpis}
            </ScrollView>

            {hlaska ? (
              <View style={s.hlaska} accessibilityLiveRegion="polite" testID="predani-hlaska">
                <Es.Banner tone={TON_POVAHY[hlaska.povaha]}>{hlaska.text}</Es.Banner>
              </View>
            ) : null}

            <View style={s.pata}>
              <ZkoseneTlacitko
                text={cta.text}
                ikona={cta.ikona}
                ikonaZa={cta.ikona === "sipka"}
                disabled={cta.disabled}
                podklad={tema.surface}
                onPress={cta.onPress}
                testID={cta.testID}
              />
              {cta.duvod ? <Text style={s.duvod} testID="predani-duvod">{cta.duvod}</Text> : null}
            </View>
          </KeyboardAvoidingView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  razitko: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 16,
  },
});

function styly(t: Tema) {
  const mono = { fontFamily: t.fonts.mono, fontVariant: ["tabular-nums" as const] };
  return StyleSheet.create({
    list: { flex: 1, backgroundColor: t.bg },
    hlavicka: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.spacing.s3,
      paddingVertical: 10,
      paddingHorizontal: t.spacing.s4,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
      backgroundColor: t.surface,
    },
    zpet: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingRight: 4 },
    zpetText: { color: t.muted, fontSize: 13, fontWeight: "600", fontFamily: t.fonts.sans },
    kdo: { flex: 1, minWidth: 0 },
    kdoNadpis: { color: t.strong, fontSize: 14, fontWeight: "700", fontFamily: t.fonts.display, letterSpacing: 0.14 },
    kdoDoklad: { ...mono, color: t.muted, fontSize: 13 },
    kroky: {
      flexDirection: "row",
      gap: 2,
      paddingHorizontal: t.spacing.s4,
      paddingBottom: t.spacing.s3,
      backgroundColor: t.surface,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    krok: { flex: 1, paddingTop: 7, borderTopWidth: 3, borderTopColor: t.border },
    krokText: {
      ...mono,
      fontSize: 10,
      fontWeight: "600",
      letterSpacing: 0.6,
      textTransform: "uppercase",
      color: t.muted,
    },
    obsah: { padding: t.spacing.s4, gap: t.spacing.s3 },
    hlaska: { paddingHorizontal: t.spacing.s4, paddingBottom: t.spacing.s2 },
    pata: {
      paddingVertical: t.spacing.s3,
      paddingHorizontal: t.spacing.s4,
      borderTopWidth: 1,
      borderTopColor: t.border,
      backgroundColor: t.surface,
      gap: t.spacing.s2,
    },
    duvod: { textAlign: "center", color: t.muted, fontSize: 13, fontFamily: t.fonts.sans },
    hotovo: { alignItems: "center", paddingVertical: t.spacing.s5, paddingHorizontal: t.spacing.s4 },
    hotovoNadpis: { color: t.strong, fontSize: 22, fontWeight: "700", fontFamily: t.fonts.display, marginBottom: 4 },
    hotovoPod: { color: t.muted, fontSize: 13.5, fontFamily: t.fonts.sans, textAlign: "center" },
    zisk: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: t.spacing.s4 },
    ziskPlus: { ...mono, color: t.primary, fontSize: 26, fontWeight: "700" },
    ziskCislo: { color: t.primary, fontSize: 40, fontWeight: "700", fontFamily: t.fonts.display },
    ziskJednotka: {
      ...mono,
      color: t.muted,
      fontSize: 12,
      fontWeight: "600",
      letterSpacing: 1,
      textTransform: "uppercase",
    },
    radky: { marginTop: t.spacing.s2 },
    dalsi: { marginTop: 0 },
    dalsiNadpis: { color: t.strong, fontSize: 15, fontWeight: "600", fontFamily: t.fonts.sans, marginTop: 6, marginBottom: 2 },
    dalsiPod: { color: t.muted, fontSize: 13, fontFamily: t.fonts.sans },
  });
}
