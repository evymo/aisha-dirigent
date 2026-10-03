/**
 * Velké zkosené tlačítko makety (`.big-btn`: clip-path, rohy 11 px vlevo nahoře a
 * vpravo dole, Archivo 700 italic UPPERCASE). Hlavní úkon obrazovky — jeden na plochu.
 *
 * ⭐ Zkosení = dva trojúhelníky v barvě PODKLADU. RN clip-path nemá a SVG maska by
 *    kvůli jednomu tvaru tahala měření rozměrů; trojúhelník z okrajů je jeden View.
 *    Proto `podklad`: tlačítko na kartě má pod sebou kartu, v patě listu patu.
 *
 * ⛔ Zakázané tlačítko NENÍ jen průhlednější. Barva sama by v protisvětle zmizela —
 *    mění se výplň (primární → vyvýšená plocha) a volající pod ním říká PROČ.
 */
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Check, ChevronRight, PenLine } from "lucide-react-native";
import { Es } from "@/extranet/esdk";

const IKONY = { pero: PenLine, fajfka: Check, sipka: ChevronRight } as const;

export function ZkoseneTlacitko({
  text,
  onPress,
  disabled = false,
  ikona,
  ikonaZa = false,
  podklad,
  testID,
}: {
  text: string;
  onPress: () => void;
  disabled?: boolean;
  ikona?: keyof typeof IKONY;
  /** Ikona za textem („Pokračovat ›"), jinak před ním. */
  ikonaZa?: boolean;
  /** Barva plochy pod tlačítkem — z ní jsou rohy. Výchozí je karta. */
  podklad?: string;
  testID?: string;
}) {
  const t = Es.useEsdk();
  const Ikona = ikona ? IKONY[ikona] : null;
  const barvaTextu = disabled ? t.muted : t.primaryInk;
  const ikonaEl = Ikona ? <Ikona size={18} color={barvaTextu} strokeWidth={2.4} /> : null;
  const roh = podklad ?? t.surface;
  return (
    <TouchableOpacity
      style={[styles.tlacitko, { backgroundColor: disabled ? t.raised : t.primary, borderRadius: t.radii.sm }]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      testID={testID}
    >
      <View style={[styles.roh, styles.vlevoNahore, { borderTopColor: roh }]} />
      <View style={[styles.roh, styles.vpravoDole, { borderBottomColor: roh }]} />
      {ikonaZa ? null : ikonaEl}
      <Text
        style={[
          styles.text,
          { color: barvaTextu, fontFamily: t.fonts.display },
        ]}
      >
        {text}
      </Text>
      {ikonaZa ? ikonaEl : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tlacitko: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    overflow: "hidden",
    paddingHorizontal: 16,
  },
  roh: { position: "absolute", width: 0, height: 0 },
  vlevoNahore: { top: 0, left: 0, borderTopWidth: 11, borderRightWidth: 11, borderRightColor: "transparent" },
  vpravoDole: { bottom: 0, right: 0, borderBottomWidth: 11, borderLeftWidth: 11, borderLeftColor: "transparent" },
  text: {
    fontWeight: "700",
    fontStyle: "italic",
    fontSize: 15.5,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
});
