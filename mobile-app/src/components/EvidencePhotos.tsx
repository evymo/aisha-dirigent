/**
 * Photos taken at a handover — the driver design's "Jen když je co řešit".
 *
 * Optional by design: the tiles stay collapsed behind a toggle and nothing here
 * is required to finish a step. Which slots exist is DATA from the node's
 * template (see lib/evidencePhotos); the labels are i18n keys the instance owns,
 * so this component names no domain concept of its own.
 *
 * Position is deliberately NOT collected. The design mock shows "GPS" on a
 * captured tile, but the platform derives a step's position server-side
 * (`workflow_step_derived_position`) and does not take it from the client —
 * a coordinate the phone supplied would be evidence of nothing.
 */
import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image, Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Camera, Check } from "lucide-react-native";
// ⛔ PŘÍMO, NE PŘES BARREL `@/hooks`. Ten vtáhne `useAuth` → auth → oidc →
// `expo-linking`, které při importu chce schéma — a test komponenty, která
// s přihlášením nemá nic společného, na tom padá. Táž třída jako `knock.ts`.
import { useTranslation } from "@/hooks/useTranslation";
import { colors, spacing } from "@/theme";
import { photoCount, setSlot, type PhotoSet, type PhotoSlot } from "@/lib/evidencePhotos";
import { safeError } from "@/lib/security/safeLogger";

/**
 * Jak dlouho jde smazání vzít zpět.
 *
 * ⛔ PROČ TO VŮBEC JE. Pořídit fotku stojí čtyři úkony (klepnout, povolit,
 * spoušť, potvrdit); SMAZAT ji stál JEDEN DOTEK bez ptaní. Destruktivní úkon
 * byl levnější než konstruktivní — a u rampy se ta fotka znovu pořídit nedá:
 * paleta je složená, kamion odjel, doklad je podepsaný.
 *
 * ⚠️ POTVRZOVACÍ DIALOG BY BYL HORŠÍ. Přefocení je běžný, legitimní úkon
 * (rozmazané, protisvětlo) a dialog by ho zdražil všem, aby ochránil vzácný
 * překlep. Vrácení zpět nezdržuje nikoho: kdo mazal schválně, chip ignoruje.
 *
 * ⛔ 20 s, ne obvyklých 5 (snackbar) ani 8. Doporučení pro „důležité, s akcí"
 * končí kolem 10 s — ale ta doporučení počítají se člověkem, který se na
 * displej dívá. Řidič v rukavicích u rampy se na něj nedívá: klepne, otočí se
 * k paletě, a teprve pak se podívá. A protože smazaný důkaz se znovu pořídit
 * NEDÁ, je cena za chip, který visí déle, nulová — kdežto cena za okno, které
 * stihne vypršet, je ztracená fotka.
 *
 * ⚠️ Naměřeno při vizuální kontrole 2026-08-20: než jsem stihl klepnout
 * a pořídit snímek, okno vypršelo. To je přesně ta situace, kterou má chránit.
 */
const VRATNE_OKNO_MS = 20000;

export interface EvidencePhotosProps {
  slots: PhotoSlot[];
  photos: PhotoSet;
  onChange: (photos: PhotoSet) => void;
}

export function EvidencePhotos({ slots, photos, onChange }: EvidencePhotosProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /**
   * Poslední smazaná fotka — dokud běží vratné okno.
   *
   * ⛔ ŽIJE V KOMPONENTĚ, NE VÝŠ. Když se formulář zavře, komponenta zmizí
   * i s ní: „Vrátit" po přechodu na jiný krok by fotku obnovilo někam, odkud
   * už člověk odešel.
   */
  const [smazana, setSmazana] = useState<{ slot: string; foto: PhotoSet[string] } | null>(null);
  const casovac = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Časovač nesmí přežít komponentu — jinak sáhne na stav, který už není.
  useEffect(() => () => { if (casovac.current) clearTimeout(casovac.current); }, []);

  const zapomen = () => {
    if (casovac.current) clearTimeout(casovac.current);
    casovac.current = null;
    setSmazana(null);
  };

  const vrat = () => {
    if (!smazana) return;
    onChange(setSlot(photos, smazana.slot, smazana.foto));
    zapomen();
  };
  const n = photoCount(photos);

  const label = (slot: PhotoSlot) => (slot.label_key ? t(slot.label_key) : t("evidence.photo"));

  const capture = async (slot: PhotoSlot) => {
    // A filled tile clears — the same tap that took it takes it back, which is
    // the whole undo story a person needs while standing at a tailgate.
    if (photos[slot.key]) {
      // Smaže se HNED (žádný dialog — přefocení je běžný úkon), ale dá se to
      // vzít zpět. Viz `VRATNE_OKNO_MS`.
      const zaloha = photos[slot.key];
      onChange(setSlot(photos, slot.key, undefined));
      if (casovac.current) clearTimeout(casovac.current);
      setSmazana(zaloha ? { slot: slot.key, foto: zaloha } : null);
      casovac.current = setTimeout(() => { casovac.current = null; setSmazana(null); }, VRATNE_OKNO_MS);
      return;
    }
    // Nové focení do TÉHOŽ slotu zahazuje starou nabídku — vrátit „předchozí"
    // přes čerstvý snímek by tiše přepsalo to, co člověk právě pořídil.
    if (smazana?.slot === slot.key) zapomen();
    setBusy(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t("evidence.cameraDeniedTitle"), t("evidence.cameraDenied"));
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        // Evidence, not a portrait: no editor step, and quality low enough that
        // a delivery note stays legible without making the upload a burden on
        // a phone that may be on a lorry's mobile data.
        allowsEditing: false,
        quality: 0.6,
        exif: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      onChange(
        setSlot(photos, slot.key, {
          uri: asset.uri,
          takenAt: new Date().toISOString(),
          mimeType: asset.mimeType,
          fileSizeBytes: asset.fileSize,
        }),
      );
    } catch (error) {
      safeError("evidence.capture", error);
      Alert.alert(t("evidence.captureFailedTitle"), t("evidence.captureFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <TouchableOpacity
        style={[styles.toggle, open && styles.toggleOpen]}
        onPress={() => setOpen((v) => !v)}
        testID="evidence-photos-toggle"
      >
        <Camera size={15} color={open ? colors.primary : colors.textSecondary} />
        <Text style={[styles.toggleText, open && styles.toggleTextOpen]}>
          {t("evidence.photos")}{n ? ` · ${n}` : ""}
        </Text>
      </TouchableOpacity>

      {/*
        ⛔ VRÁTIT SMAZANOU FOTKU. Ukazuje se i se zavřenými dlaždicemi: kdo
        omylem klepl a panel sbalil, musí mít nabídku pořád na očích — jinak
        je vratné okno pojistka, která nechytá.
      */}
      {smazana && (
        <View style={styles.vratit} testID="evidence-vratit">
          <Text style={styles.vratitText}>{t("evidence.deleted")}</Text>
          <TouchableOpacity
            onPress={vrat}
            accessibilityRole="button"
            testID="evidence-vratit-akce"
            style={styles.vratitAkce}
          >
            <Text style={styles.vratitAkceText}>{t("evidence.undo")}</Text>
          </TouchableOpacity>
        </View>
      )}

      {open && (
        <View style={styles.grid} testID="evidence-photos-grid">
          {slots.map((slot) => {
            const shot = photos[slot.key];
            return (
              <TouchableOpacity
                key={slot.key}
                style={[styles.tile, !!shot && styles.tileFilled]}
                onPress={() => capture(slot)}
                disabled={busy}
                testID={`evidence-photo-${slot.key}`}
              >
                {shot ? (
                  <>
                    <Image source={{ uri: shot.uri }} style={styles.thumb} />
                    <View style={styles.tileBadge}><Check size={13} color={colors.primary} /></View>
                    <Text style={styles.tileLabel} numberOfLines={1}>{label(slot)}</Text>
                    <Text style={styles.tileTime}>
                      {new Date(shot.takenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </Text>
                  </>
                ) : (
                  <>
                    {/*
                      ⛔ NE `textMuted` (3.60:1, pod AA). Tahle ikona je
                      AFORDANCE — jediné, co na prázdné dlaždici říká „klepni
                      a vyfoť". Co má člověk u rampy najít, musí být vidět.
                    */}
                    <Camera size={22} color={colors.textSecondary} />
                    <Text style={styles.tileLabel} numberOfLines={1}>{label(slot)}</Text>
                  </>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start",
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: 8, paddingHorizontal: spacing.md,
    // Rukavice trefí 48 pt, ne 29 (naměřeno) — terénní cesta má vlastní podlahu.
    minHeight: 48, justifyContent: "center",
  },
  toggleOpen: { borderColor: colors.primary },
  toggleText: { color: colors.textSecondary, fontSize: 14, fontWeight: "600" },
  vratit: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    gap: spacing.md, marginTop: spacing.sm,
    backgroundColor: colors.surfaceLight, borderRadius: 10,
    borderLeftWidth: 4, borderLeftColor: colors.warning,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  vratitText: { color: colors.warning, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  // Vrácení je to, co tu člověk hledá — nesmí být menší než palec v rukavici.
  vratitAkce: {
    minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.md,
    borderRadius: 8, borderWidth: 1.5, borderColor: colors.warning,
  },
  vratitAkceText: { color: colors.text, fontSize: 15, fontWeight: "700" },
  toggleTextOpen: { color: colors.primary },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  tile: {
    width: 104, height: 104, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.background, alignItems: "center", justifyContent: "center",
    padding: spacing.xs, overflow: "hidden",
  },
  tileFilled: { borderColor: colors.primary },
  thumb: { ...StyleSheet.absoluteFillObject, opacity: 0.35 },
  tileBadge: { marginBottom: 2 },
  tileLabel: { color: colors.text, fontSize: 14, fontWeight: "700", textAlign: "center" },
  // 10 px v protisvětle na rampě nikdo nepřečte — podlaha terénních textů je 13.
  tileTime: { color: colors.textSecondary, fontSize: 14, fontVariant: ["tabular-nums"] },
});
