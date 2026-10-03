/**
 * Výběr DNE nad sekcí extranetu — „ukaž mi, co bylo 3. srpna".
 *
 * Není to nová obrazovka ani nová fronta: vybraný den se posílá blokům jako
 * PARAMETR (`get_block_data` merguje `source_params || p_params`), takže
 * fronta předání, fronta odečtů i cokoli dalšího dostane týž den bez zásahu
 * do rendereru. Blok, který datum neumí, ho prostě ignoruje.
 *
 * ⭐ BEZ NATIVNÍ ZÁVISLOSTI. Hotový date picker by znamenal další nativní modul,
 * tedy nový build kvůli mřížce ze sedmi sloupců. Mřížka je proto z Views —
 * a jako vedlejší efekt vypadá stejně na obou platformách.
 *
 * ⚠️ ŽÁDNÉ `toISOString()`. To je UTC, takže v našem pásmu by po poledni
 * (resp. před 2:00 v létě) vybralo SOUSEDNÍ den — datum je tady kalendářní
 * údaj, ne okamžik. Formátuje se proto ručně z lokálních složek.
 */
import { useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useTranslation } from "@/hooks";
import { colors, spacing } from "@/theme";
import { isoDay, monthCells } from "./day";

export { isoDay, dayParams } from "./day";

/** Seznam z i18n („po,út,st,…") — bez Intl, které v RN nemusí být úplné. */
function csv(t: (k: string) => string, key: string, fallback: string[]): string[] {
  const raw = t(key);
  const parts = raw === key ? fallback : raw.split(",").map((s) => s.trim());
  return parts.length === fallback.length ? parts : fallback;
}

export function DayPicker({
  value,
  onChange,
}: {
  /** Vybraný den (YYYY-MM-DD) nebo null = bez omezení, blok si rozhoduje sám. */
  value: string | null;
  onChange: (day: string | null) => void;
}) {
  const { t } = useTranslation();
  const today = useMemo(() => new Date(), []);
  const [open, setOpen] = useState(false);
  // Který měsíc je vidět. Odvozuje se z výběru, ale listovat jde i bez něj.
  const [cursor, setCursor] = useState<Date>(() => {
    const base = value ? new Date(`${value}T00:00:00`) : today;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const weekdays = csv(t, "extranet.day.weekdays", ["po", "út", "st", "čt", "pá", "so", "ne"]);
  const months = csv(t, "extranet.day.months", [
    "leden", "únor", "březen", "duben", "květen", "červen",
    "červenec", "srpen", "září", "říjen", "listopad", "prosinec",
  ]);

  const cells = monthCells(cursor.getFullYear(), cursor.getMonth());
  const shift = (by: number) =>
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + by, 1));

  return (
    <View style={styles.wrap} testID="day-picker">
      <View style={styles.bar}>
        <TouchableOpacity
          style={styles.barMain}
          onPress={() => setOpen((o) => !o)}
          testID="day-picker-toggle"
        >
          <Text style={styles.barLabel}>{t("extranet.day.label")}</Text>
          <Text style={styles.barValue}>{value ?? t("extranet.day.current")}</Text>
        </TouchableOpacity>
        {/*
          Zrušení výběru je VLASTNÍ akce, ne „vyber si dnešek". Bez výběru totiž
          blok použije svoje nastavení (řidičova páska = dnešek a okolí), kdežto
          dnešek vybraný ručně je úzké okno na jeden den. Splynout to nesmí.
        */}
        {value && (
          <TouchableOpacity onPress={() => onChange(null)} testID="day-picker-clear">
            <Text style={styles.clear}>{t("extranet.day.clear")}</Text>
          </TouchableOpacity>
        )}
      </View>

      {open && (
        <View style={styles.panel}>
          <View style={styles.monthRow}>
            <TouchableOpacity onPress={() => shift(-1)} testID="day-picker-prev">
              <Text style={styles.nav}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.monthLabel}>
              {months[cursor.getMonth()]} {cursor.getFullYear()}
            </Text>
            <TouchableOpacity onPress={() => shift(1)} testID="day-picker-next">
              <Text style={styles.nav}>›</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.grid}>
            {weekdays.map((w) => (
              <Text key={w} style={[styles.cell, styles.weekday]}>{w}</Text>
            ))}
            {cells.map((d, i) => {
              if (!d) return <View key={`e${i}`} style={styles.cell} />;
              const iso = isoDay(d);
              const picked = iso === value;
              const isToday = iso === isoDay(today);
              return (
                <TouchableOpacity
                  key={iso}
                  style={[styles.cell, picked && styles.cellPicked]}
                  onPress={() => { onChange(iso); setOpen(false); }}
                  testID={`day-${iso}`}
                >
                  <Text style={[styles.cellText, isToday && styles.cellToday, picked && styles.cellPickedText]}>
                    {d.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  bar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  barMain: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm, flex: 1 },
  barLabel: { color: colors.textSecondary, fontSize: 13 },
  barValue: { color: colors.text, fontSize: 14, fontWeight: "700" },
  clear: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  panel: {
    marginTop: spacing.xs, backgroundColor: colors.surface, borderWidth: 1,
    borderColor: colors.border, borderRadius: 10, padding: spacing.sm,
  },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.xs },
  monthLabel: { color: colors.text, fontSize: 14, fontWeight: "700" },
  nav: { color: colors.primary, fontSize: 22, fontWeight: "800", paddingHorizontal: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, aspectRatio: 1.15, alignItems: "center", justifyContent: "center" },
  weekday: { color: colors.textSecondary, fontSize: 11, textTransform: "uppercase" },
  cellText: { color: colors.text, fontSize: 13.5 },
  cellToday: { color: colors.primary, fontWeight: "800" },
  cellPicked: { backgroundColor: colors.primary, borderRadius: 8 },
  cellPickedText: { color: colors.background, fontWeight: "800" },
});
