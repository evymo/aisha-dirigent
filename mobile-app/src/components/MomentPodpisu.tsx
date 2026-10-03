/**
 * Moment podpisu — jediná chvíle, kdy appku drží někdo jiný než řidič.
 *
 * ⭐ CO PŘEBÍRAJÍCÍ POTŘEBUJE (majitel, 2026-08-20): „ten příjemce musí vědět,
 * co přebírá, a musí se pak podepsat — ale musí taky vědět, co podepisuje."
 * Obrazovka proto nese OBOJÍ:
 *   1. ÚDAJE O DODÁVCE — co, doklad, kdy, od koho. Podle nich si to porovná
 *      s tím, co má před sebou na rampě, DŘÍV než se podepíše.
 *   2. VĚTU, KTEROU STVRZUJE. Podpis bez řečeného významu je jen čmáranice;
 *      řidič má mít v ruce doklad, který říká, co bylo potvrzeno.
 *
 * ⛔ CO SEM NEPATŘÍ. Odměna řidiče (`+N ASH`), role, přiřazení účtu — to jsou
 * údaje PROVOZU, ne dodávky. Přebírající drží telefon v ruce; co se ho netýká,
 * nemá číst. Rozhoduje o tom volající tím, které údaje sem PŘEDÁ — komponenta
 * žádný nezná a nefiltruje, takže se filtr nedá obejít změnou dat.
 *
 * ⛔ PROČ CELÁ OBRAZOVKA (UX rozbor N1, ergonomie). Podpis se kreslil do pole
 * 180 px uvnitř `ScrollView`: svislý tah si uměl vzít nadřazený scroll, takže
 * podpis „nešel" a vypadalo to jako vada appky, ne jako střet gest. Tady žádný
 * scroll není a plocha je maximální možná.
 *
 * ⚠️ Původní odůvodnění tvrdilo i únik jmen dalších odběratelů. TO BYLO ŠPATNĚ:
 * řidič se na krok dostane výhradně přes položku pásky (`/kroky?step=<id>`)
 * a obrazovka se tím zužuje na JEDEN krok (`kroky.tsx`, `all = [focused]`).
 * Cizí zakázky vidět nejsou — zůstává jen odměna a interní přiřazení výše.
 *
 * ⚠️ ŽÁDNÁ NOVÁ ZÁVISLOST. `Modal` je z jádra RN, kreslení dělá `SignaturePad`
 * (react-native-svg, už v projektu). Cenu za cizí nativní kód jsme dnes platili
 * u MLKitu — arm64 řez pro simulátor nemá a shodil celý simulátorový build.
 *
 * @module
 */
import { useState } from "react";
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, useWindowDimensions,
} from "react-native";
// ⛔ PŘÍMO, NE PŘES BARREL `@/hooks`. Ten vtáhne `useAuth` → auth → oidc →
// `expo-linking`, které při importu chce schéma — a test komponenty, která
// s přihlášením nemá nic společného, na tom padá. Táž třída jako `knock.ts`:
// první skutečný import přidá do grafu celý strom závislostí.
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "@/hooks/useTranslation";
import { colors, spacing } from "@/theme";
import { sloupec } from "@/lib/sirkaObsahu";
import { SignaturePad } from "./SignaturePad";

/** Jeden údaj o dodávce, jak ho uvidí přebírající. */
export interface UdajPredani {
  label: string;
  value?: string | null;
}

export interface MomentPodpisuProps {
  visible: boolean;
  /**
   * Co přebírá — údaje k porovnání s realitou na rampě. Prázdné se NEKRESLÍ
   * (JAZYK-03: nevyplněný řádek není informace).
   */
  udaje: readonly UdajPredani[];
  /**
   * CO PŘEBÍRÁ — položky dokladu (materiál a množství).
   *
   * ⛔ Do 2026-09-01 tu nebyly a přebírající se podepisoval pod dodávku, jejíž
   *    OBSAH mu obrazovka neukázala — viděl komu, kam a čím, ale ne co.
   *    Podpis je stvrzení převzetí; stvrzovat se dá jen to, co je vidět.
   *
   * Nepovinné: krok bez `doc_slug` (běhy vzniklé dřív) položky nemá, a prázdný
   * seznam se nekreslí (JAZYK-03) — okamžik pak vypadá jako předtím.
   */
  polozky?: readonly { nazev: string; mnozstvi: string; cekaNaKontrolu: boolean }[];
  /** Kdo podepisuje, je-li známo. */
  podepisujici?: string | null;
  /** Předmět do věty (číslo dokladu ap.). Údaj, ne doménové vědění komponenty. */
  predmet?: string | null;
  onZrusit: () => void;
  /** Potvrzeno: data URI podpisu. Volá se jen s neprázdným podpisem. */
  onHotovo: (dataUri: string) => void;
}

export function MomentPodpisu({
  visible, udaje, polozky, podepisujici, predmet, onZrusit, onHotovo,
}: MomentPodpisuProps) {
  const { t } = useTranslation();
  const [podpis, setPodpis] = useState<string | null>(null);
  const { width, height } = useWindowDimensions();
  /**
   * ⛔ MODÁL PŘES CELOU OBRAZOVKU BEZPEČNOU ZÓNU NEDOSTANE SÁM. Naměřeno na
   * snímku ze simulátoru: nadpis lezl pod stavový řádek a křížil se s hodinami.
   * `SafeAreaView` z kořene sem nesahá — `Modal` se kreslí mimo strom obrazovky.
   */
  const okraje = useSafeAreaInsets();

  /**
   * Na šířku je plocha širší a nižší — u tabletu v držáku kabiny (pravděpodobné
   * cílové zařízení) je to přirozená poloha pro podpis. Výška se počítá ze
   * SKUTEČNÝCH rozměrů: telefon i 10" tablet mají dát největší rozumnou plochu,
   * ne tutéž konstantu.
   */
  const naSirku = width > height;
  const vyskaPadu = Math.max(200, Math.round(height * (naSirku ? 0.40 : 0.34)));

  const videt = udaje.filter((u) => u.value != null && String(u.value).trim() !== "");

  const zavri = () => { setPodpis(null); onZrusit(); };
  const potvrd = () => {
    if (!podpis) return;
    const p = podpis;
    setPodpis(null);
    onHotovo(p);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      supportedOrientations={["portrait", "landscape"]}
      onRequestClose={zavri}
    >
      <View
        style={[
          styles.plocha,
          {
            paddingTop: okraje.top + spacing.lg,
            paddingBottom: Math.max(okraje.bottom, spacing.lg),
          },
        ]}
        testID="moment-podpisu"
      >
        {/*
          Údaje smí rolovat (na telefonu se jich víc nevejde), PODPISOVÁ PLOCHA
          NIKDY — proto je mimo `ScrollView`. Kdyby byla uvnitř, vrátila by se
          přesně ta vada, kvůli které tahle obrazovka vznikla.
        */}
        <ScrollView
          style={styles.udajeObal}
          contentContainerStyle={[styles.udajeObsah, sloupec]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.nadpis}>{t("handover.moment.nadpis")}</Text>

          {videt.map((u) => (
            <View key={u.label} style={styles.radek}>
              <Text style={styles.radekLabel}>{u.label}</Text>
              <Text style={styles.radekValue}>{String(u.value)}</Text>
            </View>
          ))}

          {(polozky ?? []).length > 0 ? (
            <View style={styles.polozky}>
              {(polozky ?? []).map((it, i) => (
                <View key={`${it.nazev}-${i}`} style={styles.radek}>
                  <Text style={styles.radekLabel}>
                    {it.nazev}{it.cekaNaKontrolu ? " ⚠" : ""}
                  </Text>
                  <Text style={styles.radekValue}>{it.mnozstvi}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <Text style={styles.veta}>
            {predmet
              ? t("handover.moment.veta", { predmet })
              : t("handover.moment.vetaBezPredmetu")}
          </Text>
          {podepisujici?.trim() ? (
            <Text style={styles.kdo} testID="moment-podpisu-kdo">{podepisujici.trim()}</Text>
          ) : null}
        </ScrollView>

        {/*
          ⚠️ PODPISOVÁ PLOCHA STROP NEMÁ. U textu je široko hůř, u kreslení
          líp: na tabletu se člověk podepíše pohodlně celou rukou.
        */}
        <View style={styles.padObal}>
          <SignaturePad onChange={setPodpis} height={vyskaPadu} />
        </View>

        <View style={[styles.akce, sloupec]}>
          <TouchableOpacity
            style={[styles.tlacitko, styles.zrusit]}
            onPress={zavri}
            accessibilityRole="button"
            testID="moment-podpisu-zrusit"
          >
            <Text style={styles.zrusitText}>{t("handover.moment.zrusit")}</Text>
          </TouchableOpacity>

          {/*
            ⛔ „Hotovo" je NEAKTIVNÍ, dokud podpis není. Aktivní tlačítko, které
            nic neudělá, je horší než zjevně vypnuté: člověk ho stiskne a hledá
            chybu u sebe.
          */}
          <TouchableOpacity
            style={[styles.tlacitko, styles.hotovo, !podpis && styles.hotovoVypnuto]}
            onPress={potvrd}
            disabled={!podpis}
            accessibilityRole="button"
            accessibilityState={{ disabled: !podpis }}
            testID="moment-podpisu-hotovo"
          >
            <Text style={styles.hotovoText}>{t("handover.moment.hotovo")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Svislé odsazení dosazuje bezpečná zóna (viz `okraje`) — konstanta by na
  // zařízení s výřezem schovala nadpis pod stavový řádek.
  plocha: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.lg },
  udajeObal: { flexGrow: 0, flexShrink: 1 },
  udajeObsah: { paddingBottom: spacing.md },
  nadpis: {
    color: colors.primary, fontSize: 12, fontWeight: "700",
    letterSpacing: 1.3, textTransform: "uppercase", marginBottom: spacing.md,
  },
  // Údaje čte cizí člověk a porovnává je s paletami před sebou — 15/17 px,
  // ne „meta" velikost. Terénní podlaha čitelnosti platí i tady.
  /** Obsah dodávky — oddělený od údajů, aby šlo poznat, co je co. */
  polozky: { marginTop: spacing.sm },
  radek: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
    gap: spacing.md, paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  radekLabel: { color: colors.textSecondary, fontSize: 15 },
  radekValue: { color: colors.text, fontSize: 17, fontWeight: "700", flexShrink: 1, textAlign: "right" },
  // Věta, kterou člověk stvrzuje. Ne popisek — proto velká a s prostorem.
  veta: { color: colors.text, fontSize: 18, fontWeight: "600", lineHeight: 25, marginTop: spacing.lg },
  kdo: { color: colors.textSecondary, fontSize: 16, marginTop: spacing.sm },
  padObal: { marginTop: spacing.md, marginBottom: spacing.lg },
  akce: { flexDirection: "row", gap: spacing.md, marginTop: "auto" },
  // Terénní podlaha: 56 pt. Tohle mačká člověk, který appku vidí poprvé.
  tlacitko: { flex: 1, borderRadius: 12, minHeight: 56, alignItems: "center", justifyContent: "center" },
  zrusit: { borderWidth: 1.5, borderColor: colors.border },
  zrusitText: { color: colors.textSecondary, fontSize: 16, fontWeight: "700" },
  hotovo: { backgroundColor: colors.primary },
  hotovoVypnuto: { opacity: 0.4 },
  hotovoText: { color: colors.background, fontSize: 16, fontWeight: "800" },
});
