/**
 * Denní porada — the extranet daily-brief surface, native (COEXIST read path).
 *
 * Layout comes from get_surface_layout('porada'); each block renders from
 * get_block_data via the same contract the web shells use. Presentation follows
 * the user's naturel DialogPolicy (how much to expand, brief vs standard). When
 * the surface has no blocks yet (producers still off — tenant data plane is W5)
 * it degrades to a calm empty state, never a crash.
 *
 * 'porada' is a SECTION of the extranet, not a device — sections are backend
 * data (surface_layouts.surface is open text), the same daily-brief composition
 * on every device. This screen once queried 'mobile': at the time 'porada' was
 * not in the (then closed) taxonomy, and by the time it was, the comment here
 * still said otherwise — so the screen rendered the 'mobile' grab-bag of
 * registers and digests instead of the curated pd_* daily brief.
 */
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useState } from "react";
import { Alert, View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth, useTranslation } from "@/hooks";
import { useOdhlaseniOPulnoci } from "@/hooks/useOdhlaseniOPulnoci";
import { jeKiosk } from "@/config/knock";
import { getQueueSize } from "@/services/offline";
import { colors, spacing, typography } from "@/theme";
import { useNaturel } from "@/naturel/NaturelProvider";
import { useSurfaceLayout, useSurfaceSections } from "@/extranet/useSurface";
import type { SurfaceSection } from "@/extranet/useSurface";
import { pickSurface } from "@/extranet/arrange";
import { brandDefaultSurface, TABS } from "@/extranet/surfaceRouting";
import { applyProfile, isDedicated } from "@/config/profile";
import { BlockRenderer } from "@/extranet/BlockRenderer";
import { DayPicker } from "@/extranet/DayPicker";
import { dayParams } from "@/extranet/day";
import { sloupec } from "@/lib/sirkaObsahu";
import { DoorClosed } from "lucide-react-native";

export default function PoradaScreen() {
  const okraje = useSafeAreaInsets();
  const { t } = useTranslation();
  const { policy } = useNaturel();
  const sections = useSurfaceSections();
  /**
   * Řidič přihlášený ke SVÉMU účtu na sdíleném tabletu v kabině. Tablet patří
   * kabině, ne řidiči: odhlášení musí být na očích (a o půlnoci proběhne samo),
   * jinak by další směna potvrzovala předání cizím jménem. Na telefonu se nic
   * nemění — tam je účet řidiče jeho vlastní.
   */
  const { user, signOut } = useAuth();
  useOdhlaseniOPulnoci();
  const naTabletu = jeKiosk() && !!user;
  const odhlasit = async () => {
    const proved = async () => {
      await signOut();
      // Kořen pošle tablet bez člověka zpět na dnešní rozvozy (`index.tsx`).
      router.replace("/");
    };
    // Fronta odesílá jen za přihlášeného: neodeslaná předání by po odhlášení
    // čekala, až se týž řidič na TOMTO tabletu znovu přihlásí. Říct to předem.
    const cekajici = await getQueueSize().catch(() => null);
    if (cekajici === 0) return proved();
    Alert.alert(t("kiosk.odhlasit"), t("kiosk.odhlasit_fronta"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("kiosk.odhlasit"), style: "destructive", onPress: () => void proved() },
    ]);
  };
  /**
   * Sekce z odkazu (`/porada?surface=vyvoz`). Přistávací cesta ji posílá podle
   * profilu buildu — appka řidiče otevře `vyvoz`, miniappka na odečty `meridla`.
   *
   * ⭐ Je to jen POČÁTEČNÍ hodnota, ne zámek: `setPicked` ji přebije, takže
   * deštníkový build se pořád může přepnout jinam. Dedikovaný build přepínač
   * nekreslí — ne proto, že by byl zamčený, ale protože do té appky nepatří.
   */
  const { surface: surfaceParam } = useLocalSearchParams<{ surface?: string }>();
  const [picked, setPicked] = useState<string | null>(
    typeof surfaceParam === "string" && surfaceParam.trim() !== "" ? surfaceParam.trim() : null,
  );
  /**
   * Vybraný den. `null` = nevybráno, tedy KAŽDÝ BLOK SI ROZHODUJE SÁM (řidičova
   * páska ukazuje dnešek a okolí). Není to totéž jako „vybral jsem dnešek",
   * což je úzké okno na jediný den — proto se to nesmí slít do jedné hodnoty.
   */
  const [day, setDay] = useState<string | null>(null);

  // Which sections exist is DATA, and so is their order — the rule for picking
  // one lives in `arrange` so this screen and its test cannot drift apart.
  // Hardcoding a single surface here is what kept měřidla, vozový park and
  // stroje off the phone entirely.
  // Co server vydal, zúžené na to, co tenhle build nabízí. Zúžení, nikdy
  // rozšíření — nárok rozhoduje výhradně server, profil jen nenabízí.
  //
  // `unmatched` = sekce, kterou profil jmenuje a server ji NEVYDAL. Nesmí se
  // spolknout: bez ní by překlep v profilu vypadal jako „dnes nic nemáš".
  const { sections: available, unmatched } = applyProfile(sections.data ?? []);
  // Co si build přeje, když uživatel nevybral. Brand DATA, ne konstanta v kódu.
  const brandSurface = brandDefaultSurface();
  const surface = pickSurface(available, picked, brandSurface === TABS ? undefined : brandSurface);

  const layout = useSurfaceLayout(surface);

  // `presentation: 'detail'` = blok čte JEDEN záznam a v seznamu sekce by bez
  // identity vydal jen prázdný rám (umístěný být musí — dispečer pouští jen
  // umístěné bloky). Na telefonu detail záznamu zatím není, takže se tu
  // nekreslí vůbec; parita s web shellem (App.tsx loadConsole), naměřeno
  // 2026-09-05 na registru dvojčat. Nápověda, ne maska: neznámá hodnota dál
  // degraduje na výchozí kreslení.
  const blocks = (layout.data ?? [])
    .filter((b) => b.presentation !== "detail")
    .sort((a, b) => a.position - b.position);

  /**
   * Section names are i18n KEYS owned by the instance and served from the DB to
   * the web shell. This bundle does not carry them, and i18next echoes a missing
   * key back — printing `app.sections.meridla` at the user. Fall back to the
   * section's own slug instead of showing plumbing.
   */
  const sectionLabel = (s: SurfaceSection): string => {
    if (!s.title_key) return s.section;
    const translated = t(s.title_key);
    return translated === s.title_key ? s.section : translated;
  };

  /**
   * Nadpis obrazovky. Porada má vlastní vypsaný název (je to nejstarší sekce a
   * překlad pro ni v balíku JE); ostatní sekce mluví svým vlastním jménem.
   */
  const current = available.find((s) => s.section === surface);
  const headingLabel =
    surface === "porada" ? t("extranet.porada.title") : current ? sectionLabel(current) : surface;

  return (
    <ScrollView
      style={styles.container}
      // ⛔ NA TABLETU SE OBSAH NEROZTAHUJE — je to obrazovka, na které řidič
      // po přihlášení PŘISTANE. Strop nese contentContainer, pozadí zůstává
      // na `style` a kryje celou plochu (viz lib/sirkaObsahu).
      // Obrazovka je bez hlavičky, takže výřez displeje a stavový řádek řeší ona sama
      // — pevné odsazení nechávalo nadpis pod nimi (2026-09-29).
      contentContainerStyle={[styles.content, sloupec, { paddingTop: spacing.lg + okraje.top }]}
      refreshControl={<RefreshControl refreshing={layout.isRefetching} onRefresh={() => layout.refetch()} tintColor={colors.primary} />}
      testID="porada-screen"
    >
      {/*
        Hlavička mluví o TÉHLE sekci, ne o poradě. Obrazovka je generická od
        začátku (kreslí layout kterékoli sekce) — jen si do dneška bez ohledu na
        obsah říkala „Denní porada", takže řidičova páska by běžela pod cizím
        názvem. Jméno sekce je i18n klíč INSTANCE, servírovaný s ní.

        Odkaz „na taby" je cesta VEN z extranetu — v dedikované appce žádné ven
        není, tak se nekreslí.
      */}
      <View style={styles.header}>
        <Text style={styles.overline}>{surface === "porada" ? t("extranet.porada.overline") : t("extranet.overline")}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          {!isDedicated() && (
            <TouchableOpacity onPress={() => router.push("/(tabs)")} testID="porada-to-tabs">
              <Text style={styles.link}>{t("extranet.porada.toTabs")} →</Text>
            </TouchableOpacity>
          )}
          {/*
            DVEŘE VŽDYCKY — i v dedikované appce.

            ⛔ NAMĚŘENO 2026-09-05: tahle obrazovka má v `_layout.tsx`
            `headerShown: false`, takže NEDĚDÍ symbol z hlavičky záložek.
            Kdo tu uvízl po změně sítě, neměl kam sáhnout.

            ⭐ Na rozdíl od odkazu „na taby" se NEPODMIŇUJE `isDedicated()`:
            cesta ven z extranetu v dedikované appce nedává smysl, ale
            zaklepat potřebuje řidič úplně stejně — spíš víc, protože jinou
            obrazovku nemá.
          */}
          {naTabletu && (
            <TouchableOpacity onPress={() => void odhlasit()} hitSlop={12} testID="porada-odhlasit" accessibilityRole="button">
              <Text style={styles.link}>{t("kiosk.odhlasit")}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => router.push("/zaklepat")}
            hitSlop={12}
            testID="porada-zaklepat"
            accessibilityRole="button"
          >
            <DoorClosed size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>
      <Text style={styles.title}>{headingLabel}</Text>
      {naTabletu && (
        <Text style={styles.link} testID="porada-prihlasen">
          {t("kiosk.prihlasen_jako").replace("{name}", user?.fullName || user?.email || "")}
        </Text>
      )}

      {/*
        Section switcher. Inactive sections are DRAWN, greyed and untappable —
        a section declared but not yet wired to a source is a visible gap, not an
        absent one; hiding it would quietly claim the extranet is complete.
        Shown only when there is something to switch between.
      */}
      {available.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.sectionBar}
          contentContainerStyle={styles.sectionBarContent}
          testID="porada-sections"
        >
          {available.map((s) => {
            const inactive = s.state === "inactive";
            const current = s.section === surface;
            return (
              <TouchableOpacity
                key={s.section}
                disabled={inactive}
                onPress={() => setPicked(s.section)}
                style={[styles.chip, current && styles.chipCurrent, inactive && styles.chipInactive]}
                testID={`porada-section-${s.section}`}
              >
                <Text
                  style={[styles.chipText, current && styles.chipTextCurrent, inactive && styles.chipTextInactive]}
                  numberOfLines={1}
                >
                  {sectionLabel(s)}
                </Text>
                {inactive && <Text style={styles.chipHint}>{t("extranet.sections.inactive")}</Text>}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <TouchableOpacity style={styles.krokyLink} onPress={() => router.push("/kroky")} testID="porada-to-kroky">
        <Text style={styles.krokyLinkText}>{t("workflow.steps.title")} →</Text>
      </TouchableOpacity>

      <DayPicker value={day} onChange={setDay} />

      {/*
        ⛔ Profil buildu jmenuje sekci, kterou server nevydal.
        Dvě různé příčiny, obě sem patří: překlep v profilu (vada nasazení), nebo
        člověk, který na tu sekci nemá nárok (vada přiřazení). Appka nerozhoduje
        která — vysloví, co ví, a jmenuje sekci, aby to šlo dohledat. Tichý
        přechod na jinou sekci by obojí schoval.
      */}
      {unmatched.length > 0 && (
        <View style={styles.notice} testID="porada-profile-unmatched">
          <Text style={styles.noticeTitle}>{t("extranet.profile.unmatchedTitle")}</Text>
          <Text style={styles.noticeText}>
            {t("extranet.profile.unmatchedHint", { sections: unmatched.join(", ") })}
          </Text>
        </View>
      )}

      {layout.isLoading && <Text style={styles.muted}>{t("common.loading")}</Text>}

      {layout.isError && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{t("extranet.porada.loadError")}</Text>
        </View>
      )}

      {!layout.isLoading && !layout.isError && blocks.length === 0 && (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>{t("extranet.porada.emptyTitle")}</Text>
          <Text style={styles.noticeText}>{t("extranet.porada.emptyHint")}</Text>
        </View>
      )}

      {/*
        Den se posílá VŠEM blokům sekce. Renderer o žádném datu nerozhoduje —
        klíče čte blokové RPC, a to, které je nezná, je ignoruje. Kalendář tak
        platí i pro fronty, které vzniknou později, bez zásahu sem.
      */}
      {blocks.map((block) => (
        <BlockRenderer
          key={block.block_slug}
          block={block}
          policy={policy}
          // `want_target` je DEKLARACE SCHOPNOSTI KLIENTA, ne volba bloku: tenhle
          // klient `target` umí vykreslit, tak o něj žádá. Server ho jinak
          // neposílá — starší build by na neznámém poli zneplatnil celý blok.
          params={{ want_target: true, ...dayParams(day) }}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs },
  overline: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  link: { color: colors.textSecondary, fontSize: 13 },
  krokyLink: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    marginBottom: spacing.md, alignSelf: "flex-start",
  },
  krokyLinkText: { color: colors.primary, fontSize: 13.5, fontWeight: "700" },
  title: { fontSize: typography.h2.fontSize, fontWeight: "800", color: colors.text, marginBottom: spacing.md },
  sectionBar: { marginBottom: spacing.md },
  sectionBarContent: { gap: spacing.sm, paddingRight: spacing.md },
  chip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  chipCurrent: { borderColor: colors.primary, backgroundColor: colors.background },
  chipInactive: { opacity: 0.5 },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: "600" },
  chipTextCurrent: { color: colors.primary },
  // Neaktivní neznamená nečitelný: mezi sekcemi řidič PŘEPÍNÁ, takže musí
  // přečíst i tu, na které právě není.
  chipTextInactive: { color: colors.textSecondary },
  // ⛔ 10 px pod 3.60:1 byl nejhůř čitelný text v celé appce.
  chipHint: { color: colors.textSecondary, fontSize: 13 },
  notice: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing.lg },
  noticeTitle: { color: colors.text, fontSize: 15, fontWeight: "700", marginBottom: spacing.xs },
  noticeText: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  muted: { color: colors.textSecondary, fontSize: 14 },
});
