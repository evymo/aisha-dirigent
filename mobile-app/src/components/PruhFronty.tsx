/**
 * Pruh fronty — jediné místo, kde je vidět, co ještě neodešlo.
 *
 * ⛔ PROČ VZNIKL. Řidič potvrdí předání v lomu, hláška řekne „uloženo, odejde
 * samo" a za tři vteřiny zmizí. Od té chvíle nemá jak zjistit, jestli práce
 * odešla — a to je přesně ten okamžik, kdy volá dispečerovi. Fronta přitom
 * v zařízení celou dobu je; jen ji nikdo nekreslil.
 *
 * ⭐ MLČÍ, KDYŽ NENÍ CO ŘÍCT (JAZYK-03). Trvalý pruh „vše odesláno" by se za
 * dva dny stal součástí pozadí a v den, kdy se změní na „3 čekají", by si ho
 * nikdo nevšiml. Rozhoduje `stavFronty` — a to, že se má mlčet, je tam měřené
 * tvrzení, ne vlastnost téhle komponenty.
 *
 * ⛔ TVRZENÍ SE NEZMĚKČUJE. Když trezor nejde přečíst, pruh řekne „nevím" —
 * nikdy nulu. Odznak s nulou nad podepsaným předáním, které se jen nedá
 * přečíst, je horší než žádný: člověk odjede od rampy v dobré víře.
 *
 * @module
 */
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useTranslation } from "@/hooks/useTranslation";
import { colors, spacing } from "@/theme";
import { stavFronty, type PovahaFronty, type VstupFronty } from "@/lib/stavFronty";

export interface PruhFrontyProps extends VstupFronty {
  /** Ruční pokus. Nabízí se jen tam, kde může něco změnit. */
  onZkusit?: () => void;
}

/**
 * Naléhavost je vlastnost STAVU, ne rozhodnutí kreslení — proto tabulka vedle
 * `stavFronty`, a ne `if` uvnitř JSX. Pořadí je záměrné: „čeká" je normální
 * provozní stav a nemá křičet; „vyžaduje člověka" křičet musí, protože se to
 * samo nespraví.
 */
const BARVA: Record<PovahaFronty, string> = {
  // ⛔ NE `textSecondary`. Naměřeno na snímku ze simulátoru: šedá na šedém
  // podkladu byla nejslabší prvek obrazovky — a přitom je to pro řidiče
  // NEJČASTĚJŠÍ stav (u rampy bývá bez signálu). Bílá nekřičí jako výstraha,
  // ale je vidět; naléhavost dál nese jen barevný pruh vlevo.
  ceka: colors.text,
  odesila: colors.info,
  nevim: colors.warning,
  "vyzaduje-cloveka": colors.error,
};

export function PruhFronty({ onZkusit, ...vstup }: PruhFrontyProps) {
  const { t } = useTranslation();
  const stav = stavFronty(vstup);
  if (!stav) return null;

  const barva = BARVA[stav.povaha];
  const text =
    stav.pocet == null
      ? t("fronta.nevim")
      : t(`fronta.${stav.povaha}`, { n: stav.pocet });

  /**
   * Ruční pokus se nabízí, jen když může něco změnit. Bez signálu neudělá nic
   * a tlačítko, které nic neudělá, učí lidi nedůvěřovat i těm ostatním.
   * Během odesílání by druhý běh jen soupeřil s prvním.
   */
  const lzeZkusit = Boolean(onZkusit) && vstup.isConnected && stav.povaha !== "odesila";

  return (
    <View
      style={[styles.pruh, { borderLeftColor: barva }]}
      testID="pruh-fronty"
      accessibilityLiveRegion="polite"
      accessibilityLabel={text}
    >
      <Text style={[styles.text, { color: barva }]} testID="pruh-fronty-text">{text}</Text>
      {lzeZkusit && (
        <TouchableOpacity
          onPress={onZkusit}
          accessibilityRole="button"
          testID="pruh-fronty-zkusit"
          style={styles.akce}
        >
          <Text style={styles.akceText}>{t("fronta.zkusit")}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pruh: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    gap: spacing.md,
    backgroundColor: colors.surfaceLight,
    borderRadius: 10, borderLeftWidth: 4,
    paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    // Terénní podlaha: pruh se čte za jízdy prstem v rukavici, ne v klidu.
    minHeight: 48,
  },
  text: { fontSize: 15, fontWeight: "700", flexShrink: 1 },
  akce: {
    minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.md,
    borderRadius: 8, borderWidth: 1.5, borderColor: colors.border,
  },
  akceText: { color: colors.text, fontSize: 15, fontWeight: "700" },
});
