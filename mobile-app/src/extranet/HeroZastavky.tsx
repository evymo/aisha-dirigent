/**
 * Hlavní karta zastávky (`.hero` makety) — táž na pásce (karta TEĎ) i v detailu kroku.
 *
 * Maketa kreslí `.hero` v `NowCard` (páska) i v `StopDetail` (detail) — jeden tvar,
 * dvě místa. Dřív byl jen na pásce a detail měl vlastní hlavičku jiného jazyka, takže
 * řidič po klepnutí na kartu přistál „jinde". Tvar teď bydlí tady a obě místa si jen
 * dosadí obsah (co je pod nadpisem, rozhoduje volající).
 *
 * Tvar (driver.css): plocha s rámečkem, výstražný pruh vlevo (šikmo 7 px primární /
 * 22 %), obrysové „ghost" číslo vpravo nahoře (volitelné), horní řádek overline +
 * chip dokladu (+ lampa stavu), nadpis Archivo 800 italic UPPERCASE, citace.
 *
 * ⛔ Ghost číslo jen se zdrojem. Na pásce je to pořadí spočtené z pásky; detail kroku
 *    pořadí nezná (fronta obrazovky kroků je jiné pořadí než páska) → nekreslí ho.
 */
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Defs, Pattern, Rect, Text as SvgText } from "react-native-svg";
import { Es } from "./esdk";
import type { LampState } from "./esdk";

type Tema = ReturnType<typeof Es.useEsdk>;

/** `#RRGGBB` + průhlednost → `rgba()`. Maketa míchá primární barvu na 22 / 75 %. */
export function sAlfou(hex: string, alfa: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alfa})`;
}

/** Výstražný pruh vlevo — šikmé pruhy 7 px, primární / 22 %. */
function VystraznyPruh({ barva }: { barva: string }) {
  return (
    <View style={pevne.pruh} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="hero-pruh" width={14} height={14} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <Rect x={0} y={0} width={7} height={14} fill={barva} />
            <Rect x={7} y={0} width={7} height={14} fill={sAlfou(barva, 0.22)} />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#hero-pruh)" />
      </Svg>
    </View>
  );
}

/** Velké obrysové číslo pořadí — dekorace, čtečka ho přeskočí (pořadí nese overline). */
function GhostCislo({ tema, text }: { tema: Tema; text: string }) {
  return (
    <View
      style={pevne.ghost}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={132} height={84}>
        <SvgText
          x={128}
          y={72}
          textAnchor="end"
          fontFamily={tema.fonts.display}
          fontWeight="800"
          fontStyle="italic"
          fontSize={84}
          letterSpacing={-2.5}
          fill="none"
          stroke={sAlfou(tema.primary, 0.22)}
          strokeWidth={1.5}
        >
          {text}
        </SvgText>
      </Svg>
    </View>
  );
}

export function HeroZastavky({
  ghost,
  overline,
  chip,
  lampa,
  nadpis,
  citace,
  children,
  testID,
}: {
  /** Dvě cifry pořadí; bez zdroje `undefined` = nekreslit. */
  ghost?: string;
  overline: string;
  /** Doklad v rámečku (mono) — prázdný se nekreslí. */
  chip?: string | null;
  /** Stav vpravo nahoře (detail); slovo i glyf, ne barva sama. */
  lampa?: { state: LampState; label: string } | null;
  nadpis: string;
  citace?: string | null;
  children?: ReactNode;
  testID?: string;
}) {
  const tema = Es.useEsdk();
  const s = styly(tema);
  return (
    <View style={s.karta} testID={testID}>
      <VystraznyPruh barva={tema.primary} />
      {ghost ? <GhostCislo tema={tema} text={ghost} /> : null}
      <View style={s.horni}>
        <View style={s.horniLevy}>
          <Text style={s.overline}>{overline}</Text>
          {chip ? <Text style={s.chip}>{chip}</Text> : null}
        </View>
        {lampa ? <Es.Lamp state={lampa.state} label={lampa.label} /> : null}
      </View>
      <Text style={[s.nadpis, ghost ? s.nadpisVedleCisla : null]} numberOfLines={2} accessibilityRole="header">
        {nadpis}
      </Text>
      {citace ? <Text style={s.citace} numberOfLines={2}>{citace}</Text> : null}
      {children}
    </View>
  );
}

const pevne = StyleSheet.create({
  pruh: { position: "absolute", left: 0, top: 0, bottom: 0, width: 5 },
  ghost: { position: "absolute", right: 6, top: 16 },
});

function styly(t: Tema) {
  const mono = { fontFamily: t.fonts.mono, fontVariant: ["tabular-nums" as const] };
  return StyleSheet.create({
    karta: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: t.radii.md,
      padding: t.spacing.s4,
      paddingLeft: t.spacing.s4 + 5,
      overflow: "hidden",
      marginBottom: t.spacing.s2,
    },
    horni: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: t.spacing.s2 },
    horniLevy: { flexDirection: "row", alignItems: "center", gap: t.spacing.s2, flexWrap: "wrap", flexShrink: 1 },
    overline: {
      fontSize: 10,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: t.muted,
      fontFamily: t.fonts.sans,
    },
    chip: {
      ...mono,
      fontSize: 13,
      fontWeight: "600",
      color: t.text,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: t.radii.xs,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    nadpis: {
      fontFamily: t.fonts.display,
      fontWeight: "800",
      fontStyle: "italic",
      fontSize: 26,
      lineHeight: 27,
      letterSpacing: 0.26,
      textTransform: "uppercase",
      color: t.strong,
      marginTop: 6,
      marginBottom: 2,
    },
    // Ghost číslo je vpravo nahoře; nadpis pod ním smí běžet, ale ne přes celé.
    nadpisVedleCisla: { paddingRight: 24 },
    citace: { fontSize: 13, color: t.muted, fontFamily: t.fonts.sans },
  });
}
