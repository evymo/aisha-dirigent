/**
 * Klepátko — kód člověka, jeden datagram. Bez routeru, bez navigace.
 *
 * ⛔ PROČ SAMOSTATNÁ KOMPONENTA, A NE JEN OBRAZOVKA `/zaklepat`
 *
 * Zavřené dveře jsou přesně ten stav, kdy se aplikace NENAČTE. Uživatel skončí
 * na záchytné obrazovce v `_layout.tsx`, která se kreslí MÍSTO `AppShell` — a v
 * té chvíli žádný `<Stack>` nestojí, takže `router.push("/zaklepat")` nemá kam
 * jít. Klepátko dostupné jen přes navigaci je proto nedostupné právě tehdy, kdy
 * je ho potřeba. Změřeno na simulátoru 2026-09-06: `startup-error-screen`
 * nabízela pouze „Opakovat", což z cizí IP nemůže uspět nikdy.
 *
 * ⭐ ŤUKÁ VŽDY JEN ČLOVĚK. Komponenta klepání NABÍDNE, odeslat smí jen výslovný
 * stisk. Žádné volání z lifecycle, po přihlášení ani z retry smyčky.
 *
 * ⭐ NIKDY NEŘÍKÁ „OTEVŘENO". Dveře mlčí i při úspěchu (K2/T3): přijetí
 * a odmítnutí vypadají zvenčí identicky. Jediné, co klient POZNAT MŮŽE, je
 * jestli datagram odešel. Pravdu ověří až další požadavek na API.
 *
 * ⭐ KÓD SE NEUKLÁDÁ. Projde `deriveFromPassword`, tím se ťukne, a zmizí se
 * stavem komponenty.
 */
import { useCallback, useEffect, useState } from "react";
import Constants from "expo-constants";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { DoorClosed, ShieldAlert } from "lucide-react-native";
import { useTranslation } from "@/hooks";
import { knockWithCode } from "@/lib/knock";
import { nativeKnockDeps, nativeTabletDeps, nativeZarizeni } from "@/lib/knock-native";
import { ohlasTablet, zjistiStavTabletu, type VysledekTabletu } from "@/lib/ohlaseniTabletu";
import { jeKiosk, resolveKnockTarget } from "@/config/knock";
import { colors, spacing, typography } from "@/theme";

type Stav =
  | { faze: "zadava" }
  | { faze: "tuka" }
  /** Datagram ODEŠEL. NE „otevřeno" — to se odsud zjistit nedá. */
  | { faze: "odeslano" }
  | { faze: "neodeslano"; duvod: string };

/**
 * Stav PRŮKAZU ZAŘÍZENÍ, jak ho vidí tahle obrazovka.
 *
 * ⭐ `nevim` je vlastní stav, ne „nemá". Čtení ze secure-store je asynchronní a
 * dosadit mezitím „nemá" by znamenalo nabídnout zavedení zařízení, které průkaz
 * má — a `povereniZarizeni` existující pár schválně NEPŘEPÍŠE, takže by tlačítko
 * mlčky nedělalo nic.
 */
type StavZarizeni =
  | { faze: "nevim" }
  | { faze: "nema" }
  | { faze: "ma"; kid: string; publicKeyHex: string; scope: string }
  | { faze: "chyba"; duvod: string };

export function Klepatko({ onHotovo }: { onHotovo?: () => void }) {
  const { t } = useTranslation();
  const { target, chybi } = resolveKnockTarget();
  const [kod, setKod] = useState("");
  const [stav, setStav] = useState<Stav>({ faze: "zadava" });
  const [zarizeni, setZarizeni] = useState<StavZarizeni>({ faze: "nevim" });

  /*
    ⛔ ROZBITÝ PRŮKAZ SE UKÁŽE, NESPOLKNE. `nactiPovereni` vyhodí, když je
    uložený záznam nečitelný nebo neúplný — a je to schválně: tichá výměna klíče
    je k nerozeznání od útoku. Tady jsme ale na obrazovce, jejímž jediným
    úkolem je dostat člověka dovnitř, takže se z výjimky stane VIDITELNÝ STAV
    s tlačítkem „zapomenout" — jinak by rozbitý keychain znamenal telefon, ze
    kterého se to nedá spravit.
  */
  const nactiZarizeni = useCallback(async () => {
    try {
      const p = await nativeZarizeni().nacti();
      setZarizeni(p === null ? { faze: "nema" } : { faze: "ma", kid: p.kid, publicKeyHex: p.publicKeyHex, scope: p.scope });
    } catch (error) {
      setZarizeni({ faze: "chyba", duvod: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => { void nactiZarizeni(); }, [nactiZarizeni]);

  /*
    TABLET V KIOSKU se ohlašuje bráně sám (ohlaseniTabletu.ts) — nikdo tu není
    přihlášený, kdo by ho ohlásil. Dokud průkaz čeká na správce, stav se obnovuje;
    po schválení si tablet dveře otevírá sám (obsluhaDveri).
  */
  const kiosk = jeKiosk();
  const [tablet, setTablet] = useState<VysledekTabletu | null>(null);

  const ohlasitTablet = useCallback(async () => {
    const p = await nativeZarizeni().nacti();
    if (!p) return;
    const android = Constants.expoConfig?.android?.versionCode;
    const verze = { ridic: `${Constants.expoConfig?.version ?? "?"}${android ? ` (${android})` : ""}` };
    setTablet(await ohlasTablet(p, verze, nativeTabletDeps()));
  }, []);

  const obnovitStavTabletu = useCallback(async () => {
    const p = await nativeZarizeni().nacti();
    if (!p) return;
    const v = await zjistiStavTabletu(p, nativeTabletDeps());
    // Průkaz, o kterém brána neví (ohlášení se tehdy nepovedlo), se ohlásí znovu.
    if (v.stav === "nezname") await ohlasitTablet();
    else setTablet(v);
  }, [ohlasitTablet]);

  useEffect(() => {
    if (!kiosk || zarizeni.faze !== "ma") return;
    void obnovitStavTabletu().catch((e: unknown) =>
      setTablet({ stav: "selhalo", duvod: e instanceof Error ? e.message : String(e) }),
    );
  }, [kiosk, zarizeni.faze, obnovitStavTabletu]);

  useEffect(() => {
    if (!kiosk || tablet?.stav !== "ceka") return;
    const casovac = setInterval(() => {
      void obnovitStavTabletu().catch(() => undefined);
    }, 30_000);
    return () => clearInterval(casovac);
  }, [kiosk, tablet?.stav, obnovitStavTabletu]);

  const zavestZarizeni = useCallback(async () => {
    if (!target) return; // bez cíle není `scope`, který by se dal uložit
    try {
      // `scope` se bere ze sestavení POUZE TEĎ a hned se uloží k průkazu: od
      // téhle chvíle je to hodnota, kterou správce uvidí v otisku a podle níž
      // zařízení zapíše. Kdyby se četla při každém ťuknutí, mohla by se
      // aktualizací appky změnit pod schváleným zařízením — a to by přestalo
      // fungovat způsobem k nerozeznání od zavřených dveří.
      const p = await nativeZarizeni().zaved(target.scope);
      setZarizeni({ faze: "ma", kid: p.kid, publicKeyHex: p.publicKeyHex, scope: p.scope });
      // V kiosku jde klíč rovnou bráně — dveře jsou teď otevřené zaťukáním technika.
      if (jeKiosk()) await ohlasitTablet();
    } catch (error) {
      setZarizeni({ faze: "chyba", duvod: error instanceof Error ? error.message : String(error) });
    }
  }, [ohlasitTablet, target]);

  const zapomenoutZarizeni = useCallback(async () => {
    try {
      await nativeZarizeni().zapomen();
      setZarizeni({ faze: "nema" });
      setTablet(null);
    } catch (error) {
      setZarizeni({ faze: "chyba", duvod: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  const zaklepat = useCallback(async () => {
    if (!target || kod.length === 0) return;
    setStav({ faze: "tuka" });
    /**
     * ⛔ CHYBA SE MUSÍ CHYTIT, NE JEN DOKONČIT. Neodchycené odmítnutí v async
     * obsluze shodí v React Native celý proces — a tady jsme na záchytné
     * obrazovce, tedy poslední, kde si pád můžeme dovolit.
     */
    try {
      const vysledek = await knockWithCode(kod, target, nativeKnockDeps());
      setStav(
        vysledek.sent
          ? { faze: "odeslano" }
          : { faze: "neodeslano", duvod: vysledek.error ?? t("knock.unknown_error") },
      );
    } catch (error) {
      setStav({
        faze: "neodeslano",
        duvod: error instanceof Error ? error.message : t("knock.unknown_error"),
      });
    } finally {
      // Kód pryč ze stavu hned, jak posloužil — ať nevisí v paměti déle,
      // než je nutné. Ve `finally`, aby zmizel i po výjimce.
      setKod("");
    }
  }, [kod, t, target]);

  // Instance, která dveře nedeklaruje, nesmí nabízet ťukání naslepo: zaťukání
  // na uhodnutou adresu vypadá stejně jako zaťukání správné — tedy nijak.
  if (!target) {
    return (
      <View style={styles.wrap} testID="klepatko-nenastaveno">
        <ShieldAlert color={colors.warning} size={32} />
        <Text style={styles.nadpis}>{t("knock.not_configured")}</Text>
        <Text style={styles.popis}>{t("knock.not_configured_desc")}</Text>
        <Text style={styles.chybi}>{chybi.join("\n")}</Text>
      </View>
    );
  }

  const nelzeTukat = kod.length === 0 || stav.faze === "tuka";

  return (
    <View style={styles.wrap} testID="klepatko">
      <DoorClosed color={colors.primary} size={32} />
      <Text style={styles.nadpis}>{t("knock.title")}</Text>
      <Text style={styles.popis}>{t("knock.intro")}</Text>

      <TextInput
        accessibilityLabel={t("knock.code_label")}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        editable={stav.faze !== "tuka"}
        onChangeText={setKod}
        placeholder={t("knock.code_label")}
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        style={styles.pole}
        testID="klepatko-kod"
        value={kod}
      />

      <TouchableOpacity
        accessibilityRole="button"
        disabled={nelzeTukat}
        onPress={zaklepat}
        style={[styles.tlacitko, nelzeTukat && styles.tlacitkoVypnute]}
        testID="klepatko-tuknout"
      >
        {stav.faze === "tuka" ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Text style={styles.tlacitkoText}>{t("knock.action")}</Text>
        )}
      </TouchableOpacity>

      {stav.faze === "odeslano" && (
        <View style={styles.sdeleni}>
          {/* „Zaťukáno", ne „otevřeno" — a hned výzva ověřit to jediným
              způsobem, který existuje: zkusit projít. */}
          <Text style={styles.sdeleniNadpis}>{t("knock.sent")}</Text>
          <Text style={styles.popis}>{t("knock.sent_desc")}</Text>
          {onHotovo && (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={onHotovo}
              style={styles.tlacitko}
              testID="klepatko-zkusit-znovu"
            >
              <Text style={styles.tlacitkoText}>{t("knock.try_again_now")}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {stav.faze === "neodeslano" && (
        <View style={styles.sdeleni}>
          {/* Rozdíl mezi „neodeslal jsem" a „odeslal a dveře mlčí" je jediný,
              který klient poznat může — takže se hlásí přesně, nepolyká se. */}
          <Text style={[styles.sdeleniNadpis, { color: colors.error }]}>{t("knock.not_sent")}</Text>
          <Text style={styles.popis} testID="klepatko-duvod">{stav.duvod}</Text>
        </View>
      )}

      {/*
        PRŮKAZ ZAŘÍZENÍ — aby appka mohla ťukat sama za sebe.

        ⭐ ZAVEDENÍ NIC NEOTEVÍRÁ. Vyrobí pár, jehož soukromá půlka telefon
        neopustí, a ukáže veřejný otisk. Dokud ho správce u uživatele neschválí,
        je zařízení pro vrátného `unknown-kid` — tedy stejně němé jako předtím.
        Proto se to smí nabídnout kdykoli a nezávisle na tom, jestli zaťukání
        prošlo: „odesláno" není „otevřeno" a zavedení na tom nic nemění.

        ⭐ VEŘEJNÝ KLÍČ SE ZOBRAZUJE ZÁMĚRNĚ. Je veřejný z definice a je to
        JEDINÁ hodnota, kterou správce ke schválení potřebuje. Soukromá půlka
        se sem nedostane ani typově — `nacti` vrací i `privateKeyPem`, ale ten
        se do stavu obrazovky vědomě nekopíruje.
      */}
      {zarizeni.faze !== "nevim" && (
        <View style={styles.sdeleni} testID="klepatko-zarizeni">
          <Text style={styles.sdeleniNadpis}>{t("knock.device_title")}</Text>

          {zarizeni.faze === "nema" && (
            <>
              <Text style={styles.popis}>{t("knock.device_none")}</Text>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={zavestZarizeni}
                style={styles.tlacitko}
                testID="klepatko-zavest"
              >
                <Text style={styles.tlacitkoText}>{t("knock.device_enroll")}</Text>
              </TouchableOpacity>
            </>
          )}

          {zarizeni.faze === "ma" && (
            <>
              <Text style={styles.popis}>{t("knock.device_enrolled")}</Text>
              {kiosk ? (
                <View testID="klepatko-tablet">
                  {tablet === null && <ActivityIndicator color={colors.primary} />}
                  {tablet?.stav === "ceka" && <Text style={styles.sdeleniNadpis}>{t("knock.tablet_waiting")}</Text>}
                  {tablet?.stav === "schvaleno" && <Text style={styles.sdeleniNadpis}>{t("knock.tablet_approved")}</Text>}
                  {tablet?.stav === "odvolano" && (
                    <Text style={[styles.sdeleniNadpis, { color: colors.error }]}>{t("knock.tablet_revoked")}</Text>
                  )}
                  {tablet?.stav === "dvere-zavrene" && <Text style={styles.popis}>{t("knock.tablet_door_closed")}</Text>}
                  {tablet?.stav === "selhalo" && (
                    <Text style={styles.popis} testID="klepatko-tablet-duvod">{t("knock.tablet_failed", { duvod: tablet.duvod })}</Text>
                  )}
                  {(tablet?.stav === "dvere-zavrene" || tablet?.stav === "selhalo") && (
                    <TouchableOpacity
                      accessibilityRole="button"
                      onPress={() => void ohlasitTablet()}
                      style={styles.tlacitko}
                      testID="klepatko-tablet-znovu"
                    >
                      <Text style={styles.tlacitkoText}>{t("knock.tablet_retry")}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <Text style={styles.popis}>{t("knock.device_pending")}</Text>
              )}
              <Text style={styles.popis}>{t("knock.device_fingerprint")}</Text>
              <Text style={styles.chybi} selectable testID="klepatko-otisk">
                {zarizeni.kid}{"\n"}{zarizeni.publicKeyHex}{"\n"}scope: {zarizeni.scope}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={zapomenoutZarizeni}
                style={[styles.tlacitko, styles.tlacitkoVypnute]}
                testID="klepatko-zapomenout"
              >
                <Text style={styles.tlacitkoText}>{t("knock.device_forget")}</Text>
              </TouchableOpacity>
            </>
          )}

          {zarizeni.faze === "chyba" && (
            <>
              <Text style={[styles.sdeleniNadpis, { color: colors.error }]}>{t("knock.device_error")}</Text>
              <Text style={styles.popis} testID="klepatko-zarizeni-duvod">{zarizeni.duvod}</Text>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={zapomenoutZarizeni}
                style={[styles.tlacitko, styles.tlacitkoVypnute]}
                testID="klepatko-zapomenout"
              >
                <Text style={styles.tlacitkoText}>{t("knock.device_forget")}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chybi: {
    ...typography.caption,
    fontFamily: "monospace",
    marginTop: spacing.sm,
    textAlign: "center",
  },
  nadpis: { ...typography.h2, marginTop: spacing.md, textAlign: "center" },
  pole: {
    ...typography.body,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: spacing.lg,
    padding: spacing.md,
    width: "100%",
  },
  popis: { ...typography.bodySmall, marginTop: spacing.sm, textAlign: "center" },
  sdeleni: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    width: "100%",
  },
  sdeleniNadpis: { ...typography.h3 },
  tlacitko: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    marginTop: spacing.lg,
    padding: spacing.md,
    width: "100%",
  },
  tlacitkoText: { ...typography.label, color: colors.text },
  tlacitkoVypnute: { backgroundColor: colors.surfaceLight },
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    width: "100%",
  },
});
