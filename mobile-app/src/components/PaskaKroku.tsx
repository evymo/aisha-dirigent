/**
 * Páska kroků — levý sloupec master–detailu.
 *
 * ⭐ REJSTŘÍK, NE DRUHÁ KARTA. Karta v detailu nese práci: formulář, fotky,
 * podpis. Páska nese jen ORIENTACI — kde jsem, co mě čeká, co je hotové.
 * Kdyby opakovala kartu, řidič by na tabletu četl totéž dvakrát a přišel by
 * o důvod, proč tam ten druhý sloupec je.
 *
 * ⛔ NEVYRÁBÍ SI VLASTNÍ DATA. Dostane týž seznam, který kreslí obrazovka, a
 * jediné, co přidává, je zvýraznění otevřeného kroku. Druhý zdroj pravdy o tom,
 * „co má řidič dnes udělat", by se dřív nebo později rozešel s tím prvním.
 */
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { colors, spacing, typography } from "@/theme";
import { PASKA_SIRKA_DP } from "@/lib/rozlozeni";
import type { WorkflowStep } from "@/hooks/useWorkflowSteps";
import { podtitulKroku } from "@/lib/coSePredava";

type Props = {
  kroky: readonly WorkflowStep[];
  otevrenyId: string | null;
  naKrok: (step: WorkflowStep) => void;
  titulek: string;
  prazdno: string;
};

export function PaskaKroku({ kroky, otevrenyId, naKrok, titulek, prazdno }: Props) {
  return (
    <View style={styles.paska} testID="paska-kroku">
      <Text style={styles.titulek}>{titulek}</Text>
      <ScrollView showsVerticalScrollIndicator={false}>
        {kroky.length === 0 ? (
          <Text style={styles.prazdno}>{prazdno}</Text>
        ) : (
          kroky.map((step) => {
            const hotovo = step.status === "completed" || step.status === "failed";
            const vybrany = otevrenyId === step.step_id;
            return (
              <TouchableOpacity
                key={step.step_id}
                onPress={() => naKrok(step)}
                style={[styles.polozka, vybrany && styles.vybrana]}
                testID={`paska-krok-${step.step_code ?? step.step_id}`}
              >
                {/* Stav napřed a beze slov: v kabině se pozná dřív než text. */}
                <Text style={[styles.znacka, hotovo && styles.znackaHotovo]}>
                  {/* Odchylka má vlastní glyf — „✓“ by tvrdil, že je vše v pořádku. */}
                  {step.status === "failed" ? "■" : hotovo ? "✓" : "•"}
                </Text>
                <View style={styles.text}>
                  <Text
                    style={[styles.nazev, vybrany && styles.nazevVybrany]}
                    numberOfLines={2}
                  >
                    {step.step_name}
                  </Text>
                  {/* Týž popisek jako na kartě — jiné pojmenování téhož by
                      znamenalo, že řidič hledá dvakrát. */}
                  <Text style={styles.meta} numberOfLines={1}>
                    {podtitulKroku(step)}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  paska: {
    width: PASKA_SIRKA_DP,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  titulek: {
    ...typography.micro,
    color: colors.textSecondary,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
  },
  prazdno: { ...typography.dataSmall, color: colors.textSecondary },
  polozka: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  // Vybraný krok drží PRUH vlevo, ne jen jinou barvu textu: barva sama by
  // v protisvětle zmizela, tvar ne.
  vybrana: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    paddingLeft: spacing.sm,
    marginLeft: -spacing.sm,
  },
  znacka: { ...typography.dataSmall, color: colors.textSecondary, width: 14 },
  znackaHotovo: { color: colors.primary },
  text: { flex: 1 },
  nazev: { ...typography.dataSmall, color: colors.text, fontWeight: "600" },
  nazevVybrany: { color: colors.primary },
  meta: { ...typography.dataMicro, color: colors.textSecondary, marginTop: 2 },
});
