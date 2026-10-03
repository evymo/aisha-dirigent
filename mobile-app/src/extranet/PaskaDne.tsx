/**
 * Páska dne — `review_queue` s nápovědou `tape`, nakreslená podle makety řidiče.
 *
 * Tvar převzatý z makety (majitel 19. 8.: „páska, hero TEĎ" převzít):
 *   // HOTOVO DNES  → sbalená skupina, rozbalí se klepnutím
 *   // TEĎ          → karta: výstražný pruh, ghost číslo, nadpis, cíl, velké CTA
 *   // PŘEDE MNOU   → řádky na koleji s tečkami
 *
 * ⛔ CO Z MAKETY NENÍ, A PROČ (majitel 19. 8.: nekreslit bez zdroje dat):
 *   - okno doručení / ETA šipka, „Jízda 7 z 12", servisní sloty, konec směny —
 *     nemají zdroj; pořadí se POČÍTÁ z pásky (`heroParts.position`);
 *   - součet tun v hlavičce „Přede mnou" a u hotových — součet je nové tvrzení
 *     (viz `lib/polozkyDokladu`), ukazuje se jen počet;
 *   - „Navigovat" — adresa je obecná citace, ne pole s adresou (viz BlockRenderer).
 *
 * ⛔ NEVÍ, CO JE DODACÍ LIST. Nadpis, citace, údaje i pořadí jsou data bloku;
 * cíl („co se skládá") dodá `CilPolozky` podle druhu entity. Táž páska tak
 * odbaví i jinou frontu bez jediné větve.
 *
 * Barvy a písma jdou z jazyka (`useEsdk`: riq `noc` = paleta makety), ne z
 * `@/theme` — ten nese obecnou AISHA oranžovou a páska by se od zbytku jazyka
 * barevně rozešla.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { ZkoseneTlacitko } from "@/components/ZkoseneTlacitko";
import { useTranslation } from "@/hooks";
import { Es, Fact } from "./esdk";
import { dvojcifri, heroParts, partitionTape, type TapeItem } from "./arrange";
import { CilPolozky } from "./CilPolozky";
import { HeroZastavky, sAlfou } from "./HeroZastavky";

type Tema = ReturnType<typeof Es.useEsdk>;

/** Klepnutelné JEN s cílem — stejné pravidlo jako `QueueRow` v BlockRendereru. */
function Otevritelne({
  otevri,
  id,
  style,
  children,
}: {
  otevri?: (id: string) => void;
  id: unknown;
  style?: object;
  children: ReactNode;
}) {
  const entityId = typeof id === "string" && id ? id : null;
  if (!otevri || !entityId) return <View style={style}>{children}</View>;
  return (
    <TouchableOpacity
      style={style}
      onPress={() => otevri(entityId)}
      accessibilityRole="button"
      activeOpacity={0.85}
      testID={`queue-open-${entityId}`}
    >
      {children}
    </TouchableOpacity>
  );
}

/** `// NÁZEV` sekce pásky, volitelně s počtem vpravo. */
function Sekce({ t: tema, nazev, pocet }: { t: Tema; nazev: string; pocet?: number }) {
  const s = styly(tema);
  return (
    <View style={s.sekce} accessibilityRole="header">
      <Text style={s.sekceText}>
        <Text style={{ color: sAlfou(tema.primary, 0.75) }}>{"// "}</Text>
        {nazev}
      </Text>
      {pocet != null ? <Text style={s.sekceText}>{pocet}</Text> : null}
    </View>
  );
}

/**
 * Tečka na koleji. TEĎ je čtverec s pulzujícím halo — tvar, ne jen barva, aby
 * se poznal i v protisvětle. Pulz respektuje „omezit pohyb" systému.
 */
function Tecka({
  tema,
  druh,
  nahore = 16,
}: {
  tema: Tema;
  druh: "hotovo" | "odchylka" | "ted" | "ceka";
  /** Výška středu první řádky prvku, ke kterému tečka patří. */
  nahore?: number;
}) {
  const pulz = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (druh !== "ted") return;
    let smycka: Animated.CompositeAnimation | null = null;
    let zruseno = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((omezit) => {
        if (omezit || zruseno) return;
        smycka = Animated.loop(
          Animated.sequence([
            Animated.timing(pulz, { toValue: 0.25, duration: 800, useNativeDriver: true }),
            Animated.timing(pulz, { toValue: 1, duration: 800, useNativeDriver: true }),
          ]),
        );
        smycka.start();
      })
      .catch(() => undefined);
    return () => {
      zruseno = true;
      smycka?.stop();
    };
  }, [druh, pulz]);

  if (druh === "ted") {
    return (
      <View style={[pevne.teckaTedObal, { top: nahore - 2 }]} pointerEvents="none">
        <Animated.View style={[pevne.halo, { backgroundColor: sAlfou(tema.primary, 0.22), opacity: pulz }]} />
        <View style={[pevne.teckaTed, { backgroundColor: tema.primary }]} />
      </View>
    );
  }
  const plna = druh === "hotovo" ? tema.ok : druh === "odchylka" ? tema.faultDot : null;
  return (
    <View
      pointerEvents="none"
      style={[
        pevne.tecka,
        { top: nahore, backgroundColor: plna ?? tema.bg, borderColor: plna ?? tema.muted },
      ]}
    />
  );
}

/** Řádek pásky: pořadí | nadpis + citace | šipka. */
function Radek({
  tema,
  item,
  poradi,
  hotovy,
  otevri,
}: {
  tema: Tema;
  item: TapeItem;
  poradi: number;
  hotovy: boolean;
  otevri?: (id: string) => void;
}) {
  const s = styly(tema);
  const odchylka = item.state === "failed";
  return (
    <View>
      <Tecka tema={tema} druh={hotovy ? (odchylka ? "odchylka" : "hotovo") : "ceka"} />
      <Otevritelne otevri={otevri} id={item.id} style={[s.radek, hotovy && s.radekHotovy]}>
        <View style={s.radekPoradi}>
          <Text style={s.poradiText}>{dvojcifri(poradi)}</Text>
          {hotovy ? (
            // Odchylka má vlastní glyf — „✓" by tvrdil, že je vše v pořádku.
            <Text style={[s.poradiText, { color: odchylka ? tema.faultDot : tema.ok }]}>{odchylka ? "■" : "✓"}</Text>
          ) : null}
        </View>
        <View style={s.radekText}>
          <Text style={[s.radekNadpis, hotovy && s.radekNadpisHotovy]} numberOfLines={1}>
            {String(item.title ?? "")}
          </Text>
          {item.quote ? (
            <Text style={s.radekCitace} numberOfLines={1}>{String(item.quote)}</Text>
          ) : null}
        </View>
        {otevri && typeof item.id === "string" && item.id ? (
          <ChevronRight size={16} color={tema.muted} />
        ) : null}
      </Otevritelne>
    </View>
  );
}

export function PaskaDne({
  items,
  entityKind,
  otevri,
  otevriAkci,
  rowCap,
}: {
  items: readonly TapeItem[];
  entityKind?: string;
  otevri?: (id: string) => void;
  /**
   * CTA karty TEĎ rovnou na ÚKON (maketa: „Předání a podpis" otevře list předání),
   * klepnutí na kartu na detail. Bez akce vede CTA na detail — jako dřív.
   */
  otevriAkci?: (id: string) => void;
  rowCap: number;
}) {
  const { t } = useTranslation();
  const tema = Es.useEsdk();
  const s = styly(tema);
  const [hotoveRozbalene, setHotoveRozbalene] = useState(false);
  const { done, now, ahead } = partitionTape(items);
  const hero = heroParts(now, done.length, items.length);

  if (!items.length) return <Text style={s.prazdno}>{t("extranet.queueEmpty")}</Text>;

  return (
    <View style={s.kolej} testID="paska-dne">
      <View style={[s.cara, { backgroundColor: tema.border }]} pointerEvents="none" />

      {done.length ? (
        <View style={s.hotove}>
          {/* Skupina JE hlavička sekce — „Hotovo dnes" dvakrát nad sebou by se četlo dvakrát. */}
          <Tecka tema={tema} druh="hotovo" nahore={13} />
          <TouchableOpacity
            style={s.skupina}
            onPress={() => setHotoveRozbalene((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: hotoveRozbalene }}
            testID="paska-hotove"
          >
            <Text style={s.skupinaText}>{t("extranet.tape.done")}</Text>
            <Text style={s.skupinaPocet}>{done.length}</Text>
            <View style={hotoveRozbalene ? s.sipkaDolu : undefined}>
              <ChevronRight size={16} color={tema.muted} />
            </View>
          </TouchableOpacity>
          {hotoveRozbalene
            ? done.map((it, i) => (
                <Radek key={String(it.id ?? `h${i}`)} tema={tema} item={it} poradi={i + 1} hotovy otevri={otevri} />
              ))
            : null}
        </View>
      ) : null}

      {now ? (
        <View>
          <Sekce t={tema} nazev={t("extranet.tape.now")} />
          <View>
          <Tecka tema={tema} druh="ted" nahore={20} />
          <Otevritelne otevri={otevri} id={now.id}>
            {/* „Kolikátý z dneška" se POČÍTÁ z pásky — není to „jízda 7 z 12" z předlohy. */}
            <HeroZastavky
              ghost={hero.ghost}
              overline={t("extranet.tape.position", hero.position)}
              chip={hero.chip}
              nadpis={String(now.title ?? "")}
              citace={now.quote ? String(now.quote) : null}
            >
              <CilPolozky kind={entityKind} id={now.id}>
                {(cil) => (
                  <Text style={s.cil} testID="paska-cil">
                    <Text style={s.cilHlavni}>
                      {t("extranet.tape.goal")} {cil.hlavni}
                    </Text>
                    {cil.doplnek ? <Text style={s.cilDoplnek}>{`  ·  ${cil.doplnek}`}</Text> : null}
                    {cil.dalsich ? (
                      <Text style={s.cilDoplnek}>{`  ·  ${t("extranet.tape.moreItems", { n: cil.dalsich })}`}</Text>
                    ) : null}
                  </Text>
                )}
              </CilPolozky>

              {/* Prázdný údaj se NEKRESLÍ — o to se stará `Fact` z jazyka (JAZYK-03). */}
              {hero.facts.length ? (
                <View style={s.fakta}>
                  {hero.facts.map((f) => (
                    <Fact key={f.key} row label={t(f.label_key)} value={f.value == null ? null : String(f.value)} />
                  ))}
                </View>
              ) : null}

              {/* CTA vede na ÚKON, klepnutí na kartu na detail (maketa: NowCard vs „Vše o zastávce"). */}
              {otevri && typeof now.id === "string" && now.id ? (
                <View style={s.cta}>
                  <ZkoseneTlacitko
                    text={t("extranet.tape.handover")}
                    ikona="pero"
                    onPress={() => (otevriAkci ?? otevri)?.(now.id as string)}
                    testID="tape-hero-cta"
                  />
                </View>
              ) : null}
            </HeroZastavky>
          </Otevritelne>
          </View>
        </View>
      ) : null}

      {ahead.length ? (
        <View>
          <Sekce t={tema} nazev={t("extranet.tape.ahead")} pocet={ahead.length} />
          {ahead.slice(0, rowCap).map((it, i) => (
            <Radek
              key={String(it.id ?? `a${i}`)}
              tema={tema}
              item={it}
              poradi={done.length + 2 + i}
              hotovy={false}
              otevri={otevri}
            />
          ))}
          {ahead.length > rowCap ? (
            <Text style={s.prazdno}>{t("extranet.moreRows", { n: ahead.length - rowCap })}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Kolej: odsazení 24, čára 2 px na x = 8 → střed 9. Tečky se na ni centrují. */
const KOLEJ = 24;
const STRED = 9;

const pevne = StyleSheet.create({
  tecka: {
    position: "absolute",
    left: STRED - 5 - KOLEJ,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  teckaTedObal: { position: "absolute", left: STRED - 10 - KOLEJ, width: 20, height: 20 },
  halo: { position: "absolute", left: 0, top: 0, width: 20, height: 20, borderRadius: 6 },
  teckaTed: { position: "absolute", left: 4, top: 4, width: 12, height: 12, borderRadius: 3 },
});

/**
 * ⚠️ Od makety se liší jen velikost drobného písma: maketa má 11–12 px (citace,
 * pořadí, chip), terénní čitelnost drží podlahu 13 px (`terenniCitelnost.test`,
 * WCAG naměřené 20. 8.). Pod ni smí jen uppercase značky sekcí.
 */
function styly(t: Tema) {
  const mono = { fontFamily: t.fonts.mono, fontVariant: ["tabular-nums" as const] };
  return StyleSheet.create({
    kolej: { paddingLeft: KOLEJ, position: "relative" },
    hotove: { marginTop: t.spacing.s3 },
    cara: { position: "absolute", left: STRED - 1, top: 0, bottom: 0, width: 2 },
    prazdno: { color: t.muted, fontSize: 13, fontFamily: t.fonts.sans, marginTop: t.spacing.s2 },
    sekce: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: t.spacing.s4,
      marginBottom: t.spacing.s2,
    },
    sekceText: {
      ...mono,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.muted,
    },
    skupina: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.spacing.s3,
      borderWidth: 1,
      borderColor: t.borderSoft,
      borderRadius: t.radii.sm,
      paddingVertical: 9,
      paddingHorizontal: 12,
      marginBottom: t.spacing.s2,
    },
    skupinaText: { flex: 1, fontSize: 13, fontWeight: "600", color: t.text, fontFamily: t.fonts.sans },
    skupinaPocet: { ...mono, fontSize: 13, color: t.muted },
    sipkaDolu: { transform: [{ rotate: "90deg" }] },
    radek: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.spacing.s3,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: t.radii.sm,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: t.spacing.s2,
    },
    radekHotovy: { backgroundColor: "transparent" },
    radekPoradi: { width: 46 - 12 },
    poradiText: { ...mono, fontSize: 13, fontWeight: "600", color: t.muted },
    radekText: { flex: 1 },
    radekNadpis: { fontSize: 14, fontWeight: "600", color: t.strong, fontFamily: t.fonts.sans },
    radekNadpisHotovy: { fontWeight: "500", color: t.text },
    radekCitace: { fontSize: 13, color: t.muted, marginTop: 2, fontFamily: t.fonts.sans },
    cil: { marginTop: t.spacing.s3 },
    cilHlavni: {
      fontFamily: t.fonts.display,
      fontWeight: "800",
      fontStyle: "italic",
      fontSize: 17,
      textTransform: "uppercase",
      color: t.primary,
    },
    cilDoplnek: { fontSize: 13, color: t.muted, fontFamily: t.fonts.sans },
    fakta: { marginTop: t.spacing.s3 },
    cta: { marginTop: t.spacing.s3 },
  });
}
