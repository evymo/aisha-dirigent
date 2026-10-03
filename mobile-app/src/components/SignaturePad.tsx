/**
 * Hand-drawn signature — the one thing in a handover that no machine supplies.
 *
 * The web shell draws on a `<canvas>` and exports `image/png`. React Native has
 * no canvas, and the alternatives (view-shot, a skia surface) would each be a
 * new native dependency — a poor trade the week we learned what unowned native
 * code costs us (see scripts/build-ios.sh, RCT_USE_RN_DEP). So this draws with
 * react-native-svg, which is already a dependency, and exports the SAME KIND of
 * value the contract asks for: an image data URI. `submit_evidence_review_audited`
 * requires `data:image/%` and a payload under 262144 bytes; a vector signature is
 * a few kilobytes, so the limit is never in play and the mark stays sharp at any
 * zoom instead of being a fixed raster.
 *
 * Strokes are captured with PanResponder (React Native core, no dependency).
 */
import { useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, PanResponder, TouchableOpacity } from "react-native";
import Svg, { Path } from "react-native-svg";
// Přímo, ne přes barrel `@/hooks` — ten vtáhne `useAuth` → oidc → expo-linking
// a listová komponenta by tím do grafu přinesla celý přihlašovací strom.
import { useTranslation } from "@/hooks/useTranslation";
import { colors, spacing } from "@/theme";
import { INK, PAPER, fitsSignatureLimit, jeToPodpis, strokesToDataUri } from "@/lib/signature";

type Stroke = string;

export interface SignaturePadProps {
  /** Receives the data URI, or null whenever the pad is empty/cleared. */
  onChange: (dataUri: string | null) => void;
  height?: number;
}

export function SignaturePad({ onChange, height = 180 }: SignaturePadProps) {
  const { t } = useTranslation();
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [current, setCurrent] = useState<Stroke>("");
  const [size, setSize] = useState({ w: 0, h: height });
  const [tooLarge, setTooLarge] = useState(false);
  /** Značka je zatím jen dotek — ne chyba, jen ještě není hotovo. */
  const [prilisKratky, setPrilisKratky] = useState(false);

  // Mutable draft: PanResponder callbacks are created once and would otherwise
  // close over the first render's state.
  const draft = useRef<string>("");
  const done = useRef<Stroke[]>([]);
  const box = useRef({ w: 0, h: height });

  const emit = (all: Stroke[]) => {
    const { w, h } = box.current;
    const uri = strokesToDataUri(all, w, h);
    // Refuse locally rather than let the RPC raise: the person is standing at the
    // tailgate and needs to know to clear and sign again, not read a Postgres error.
    if (uri && !fitsSignatureLimit(uri)) {
      setTooLarge(true);
      onChange(null);
      return;
    }
    setTooLarge(false);

    /**
     * ⛔ JEDINÝ DOTEK NENÍ PODPIS. Klepnutí vyrábí platnou cestu, takže se
     * „Hotovo" rozsvítilo a řidič odeslal předání se značkou, která neznamená
     * nic. Měří se CELÁ značka, ne jednotlivý tah — tečka uvnitř podpisu je
     * legitimní (viz `jeToPodpis`).
     *
     * ⚠️ Prázdná plocha se NEHLÁSÍ: kdo se ještě nezačal podepisovat, nedělá
     * nic špatně a výtka by byla buzerování.
     */
    if (uri && !jeToPodpis(all)) {
      setPrilisKratky(true);
      onChange(null);
      return;
    }
    setPrilisKratky(false);
    onChange(uri);
  };

  // ⛔ NAMĚŘENO 2026-08-20 pravidlem `react-hooks/exhaustive-deps`, které
  // v téhle appce dosud nebylo zapnuté. `responder` se staví JEDNOU (a má
  // proč — viz komentář u jeho závislostí), takže si zapamatuje `emit`
  // z PRVNÍHO renderu a s ním i `onChange` z prvního renderu.
  //
  // Dnes to nepálí: jediný volající předává `setPodpis`, tedy setter
  // z `useState`, který React drží stabilní. Ale první `onChange={(s) => …}`
  // psané na místě by podpis tiše odeslalo do mrtvé closure — a to je právě
  // ta cesta, na které stojí důkaz o předání. Ref drží vždy poslední `emit`,
  // takže handler smí zůstat postavený jednou a přitom volat to aktuální.
  const emitRef = useRef(emit);
  emitRef.current = emit;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          draft.current = `M ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
          setCurrent(draft.current);
        },
        onPanResponderMove: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          draft.current += ` L ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
          setCurrent(draft.current);
        },
        onPanResponderRelease: () => {
          if (!draft.current) return;
          // A tap with no movement is a dot, not a stroke — keep it, a signature
          // legitimately contains them.
          done.current = [...done.current, draft.current];
          setStrokes(done.current);
          draft.current = "";
          setCurrent("");
          emitRef.current(done.current);
        },
      }),
    // Created once on purpose: the handlers read and write the refs above, so
    // they never need to be rebuilt as strokes accumulate.
    [],
  );

  const clear = () => {
    done.current = [];
    draft.current = "";
    setStrokes([]);
    setCurrent("");
    emit([]);
  };

  return (
    <View>
      <View
        style={[styles.pad, { height }]}
        onLayout={(e) => {
          const { width, height: h } = e.nativeEvent.layout;
          box.current = { w: width, h };
          setSize({ w: width, h });
        }}
        testID="signature-pad"
        {...responder.panHandlers}
      >
        <Svg width="100%" height="100%" viewBox={`0 0 ${size.w} ${size.h}`}>
          {[...strokes, current].filter(Boolean).map((d, i) => (
            <Path key={i} d={d} fill="none" stroke={INK} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </Svg>
        {!strokes.length && !current && (
          <Text style={styles.hint} pointerEvents="none">
            {t("handover.signHere")}
          </Text>
        )}
      </View>

      <View style={styles.row}>
        {tooLarge && <Text style={styles.error}>{t("handover.signatureTooLarge")}</Text>}
        {/*
          Ne chyba, ale POKYN: člověk se ještě nepodepsal, jen se dotkl. Proto
          smířlivější barva než u překročené velikosti — tam se něco pokazilo,
          tady se jen ještě nedokončilo.
        */}
        {prilisKratky && !tooLarge && (
          <Text style={styles.pokyn} testID="signature-prilis-kratky">
            {t("handover.signatureTooShort")}
          </Text>
        )}
        <TouchableOpacity onPress={clear} testID="signature-clear" style={styles.clear}>
          <Text style={styles.clearText}>{t("handover.clear")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    backgroundColor: PAPER,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    overflow: "hidden",
    justifyContent: "center",
  },
  hint: { position: "absolute", alignSelf: "center", color: "#9AA0A6", fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs },
  error: { color: colors.error, fontSize: 14, flex: 1 },
  pokyn: { color: colors.warning, fontSize: 14, flex: 1 },
  // Smazat se mačká právě tehdy, když se podpis nepovedl — tedy ve spěchu
  // a před zákazníkem. 30 pt na to bylo málo.
  clear: { paddingHorizontal: spacing.md, minHeight: 48, justifyContent: "center" },
  clearText: { color: colors.textSecondary, fontSize: 14, fontWeight: "600" },
});
