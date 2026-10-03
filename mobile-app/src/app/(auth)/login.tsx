/**
 * Login screen — OAuth (Apple/Google/Keycloak) with biometric unlock.
 * All credential flows (password, magic link) are handled by Keycloak login page.
 */
import { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { DoorClosed, Fingerprint, Shield } from "lucide-react-native";
import { authService } from "@/services/auth";
import { getRefreshToken, isLoggedIn, restoreFromRefreshToken } from "@/config/oidc";
import type { AuthProvider } from "@/services/auth";
import { useBiometric, useTranslation } from "@/hooks";
import { colors, spacing, typography } from "@/theme";
import { safeError, safeInfo } from "@/lib/security/safeLogger";
import { getUserFacingErrorMessage } from "@/lib/security/userFacingErrors";
import { describeOidcConfig } from "@/config/oidc";
import { sloupec } from "@/lib/sirkaObsahu";
import { PrihlaseniWebView } from "@/components/PrihlaseniWebView";

/**
 * ⭐ ROZHODNUTÍ MAJITELE (2026-09-28): Řidič na Androidu se přihlašuje JEN jménem
 * a heslem RIQ ID, ve vloženém WebView (tablety nemají prohlížeč ani Google Play).
 * Google/Apple se na Androidu nenabízí; iOS zůstává beze změny.
 */
const JEN_RIQ_ID = Platform.OS === "android";

export default function LoginScreen() {
  const { t } = useTranslation();
  const biometric = useBiometric();

  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  /** The provider's verbatim refusal — shown on demand, never translated away. */
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [showDiag, setShowDiag] = useState(false);
  const [webview, setWebview] = useState(false);

  // ── Triple-tap title → Settings ────────────────────────
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTitleTap = useCallback(() => {
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    if (tapCountRef.current >= 3) {
      tapCountRef.current = 0;
      router.push("/settings");
      return;
    }
    tapTimerRef.current = setTimeout(() => {
      tapCountRef.current = 0;
    }, 600);
  }, []);

  /*
    ── Biometric unlock: OFF ──────────────────────────────────────────────────
    Measured 2026-08-03 on a shipped build: a user with Face ID enabled was
    trapped in an unbreakable loop — scan, succeed, land nowhere, scan again.

    Two defects compounded. `restoreFromRefreshToken` reports failure by
    RETURNING NULL, not by throwing (config/oidc.ts), so the `catch` below never
    ran and the navigation happened unconditionally; the root then saw an
    unauthenticated session and redirected straight back here, where the effect
    fired again. And the stored refresh token could no longer be redeemed at all
    after the realm client was rebuilt, so the failure was not intermittent — it
    was every single time, with no way out of the app.

    Back ON since the two causes are gone. `offline_access` (config/oidc.ts) now
    gets a refresh token that outlives the SSO session, so there IS something to
    restore; and the null-vs-throw defect below is fixed, so a failed restore
    ends in a message and a normal sign-in rather than another scan.

    Deliberately still a constant: if this ever traps someone again, the person
    it traps cannot reach a setting to switch it off. Flipping it to false and
    shipping is the escape hatch, and it takes one line.

    Note what is NOT re-introduced: the auto-firing effect. Unlock happens when
    the user taps the button. The old effect re-ran on every identity change of
    the biometric object, which is what turned one failure into an endless loop.
  */
  const BIOMETRIC_ENABLED = true;

  const handleBiometricUnlock = useCallback(async () => {
    if (!BIOMETRIC_ENABLED) return;
    if (!biometric.isEnabled || !biometric.isEnrolled) return;

    const success = await biometric.authenticate(t("auth.biometric_prompt"));
    if (!success) return;

    const secret = await biometric.retrieveAuthSecret();
    if (!secret) return;

    // Null IS the failure signal here — treating it as success is what built
    // the loop. Navigate only once a session genuinely exists.
    const restored = await restoreFromRefreshToken(secret).catch((error) => {
      safeError("LoginScreen.biometricRefresh", error);
      return null;
    });
    if (!restored) {
      setErrorKey("auth.errors.login_failed");
      return;
    }
    // Through the root, never straight to the tabs — see below.
    router.replace("/");
  }, [BIOMETRIC_ENABLED, biometric, t]);

  // ── OAuth ──────────────────────────────────────────────
  const handleOAuthLogin = async (provider: AuthProvider) => {
    setIsLoading(true);
    setErrorKey(null);
    setErrorDetail(null);
    setShowDiag(false);
    safeInfo("Login.oauth.attempt", { provider });
    try {
      await authService.signInWithOAuth(provider);
      // After successful OIDC flow, offer biometric enrollment
      await offerBiometric();
      /*
        Land through the root, which is the ONE place that decides where an
        authenticated user goes: naturel calibration when undecided, then the
        brand's default surface by role. Jumping straight to the tabs from here
        skipped both — the extranet default never applied after an interactive
        login (only when the app reopened on an existing session), and the
        calibration step was silently bypassed.
      */
      router.replace("/");
    } catch (error) {
      safeError("Login.oauth.error", error);
      // Every failure used to collapse into "Please try again", with the real
      // cause reaching only the log — so an expired session, a refused audience
      // and no network all looked identical to the person holding the phone, and
      // nobody could act on any of them. `getUserFacingErrorMessage` already maps
      // errors to safe keys; it just was not being used here.
      setErrorKey(getUserFacingErrorMessage(error));
      setErrorDetail((error as Error)?.message ?? String(error));
      setIsLoading(false);
    }
  };

  // ── Přihlášení ve WebView (Android) ────────────────────
  const zacniWebView = () => {
    setErrorKey(null);
    setErrorDetail(null);
    setShowDiag(false);
    safeInfo("Login.oauth.attempt", { provider: "keycloak-webview" });
    setWebview(true);
  };

  const poWebView = async () => {
    setWebview(false);
    await offerBiometric();
    // Přes kořen, stejně jako po OAuth — viz handleOAuthLogin.
    router.replace("/");
  };

  const chybaWebView = useCallback((error: Error) => {
    safeError("Login.webview.error", error);
    setWebview(false);
    setErrorKey(getUserFacingErrorMessage(error));
    setErrorDetail(error.message);
  }, []);

  // ── Biometric Enrollment Offer ─────────────────────────
  const offerBiometric = async () => {
    // No new enrolments while the feature is off — otherwise the next sign-in
    // would hand someone the very trap we are closing.
    if (BIOMETRIC_ENABLED && biometric.isAvailable && biometric.isEnrolled && !biometric.isEnabled) {
      const loggedIn = await isLoggedIn();
      if (!loggedIn) return;

      Alert.alert(
        t("auth.biometric_offer_title"),
        t("auth.biometric_offer_message").replace("{name}", biometric.biometricName),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("common.save"),
            onPress: async () => {
              await biometric.enable();
              const rt = await getRefreshToken();
              if (rt) {
                await biometric.storeAuthSecret(rt);
              }
            },
          },
        ]
      );
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      testID="auth-login-screen"
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleTitleTap} activeOpacity={1}>
          <Text style={styles.title}>{t("common.app_name")}</Text>
        </TouchableOpacity>
        <Text style={styles.subtitle}>{t("auth.sign_in_subtitle")}</Text>
      </View>

      {/* Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{t("auth.sign_in_title")}</Text>
        </View>

        {errorKey && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t(errorKey)}</Text>

            {/*
              The diagnostic half. A translated sentence tells a tester that
              something failed; it never tells anyone WHAT, and on a phone there
              is no log to fall back on. So the provider's own refusal and the
              four values that decide where the request went are shown verbatim.
              None of it is secret — it all travels in the authorization request
              anyway — and the anon key and tokens are deliberately not here.
            */}
            {!!errorDetail && (
              <>
                <TouchableOpacity onPress={() => setShowDiag((v) => !v)} testID="login-diag-toggle">
                  <Text style={styles.diagToggle}>
                    {showDiag ? t("auth.diagnostics.hide") : t("auth.diagnostics.show")}
                  </Text>
                </TouchableOpacity>
                {showDiag && (
                  <View style={styles.diagBox} testID="login-diag">
                    <Text style={styles.diagLine} selectable>{errorDetail}</Text>
                    {Object.entries(describeOidcConfig()).map(([k, v]) => (
                      <Text key={k} style={styles.diagLine} selectable>{k}: {v}</Text>
                    ))}
                  </View>
                )}
              </>
            )}
          </View>
        )}

        <View style={styles.form}>
          {/* OAuth Buttons */}
          <View style={styles.oauthContainer}>
            {Platform.OS === "ios" && (
              <TouchableOpacity
                style={[styles.oauthButton, { backgroundColor: "#000", borderColor: "#000" }]}
                onPress={() => handleOAuthLogin("apple")}
                disabled={isLoading}
                testID="auth-oauth-apple"
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[styles.oauthButtonText, { color: "#fff" }]}>
                    {t("auth.oauth.apple")}
                  </Text>
                )}
              </TouchableOpacity>
            )}
            {!JEN_RIQ_ID && (
              <TouchableOpacity
                style={styles.oauthButton}
                onPress={() => handleOAuthLogin("google")}
                disabled={isLoading}
                testID="auth-oauth-google"
              >
                {isLoading ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <Text style={styles.oauthButtonText}>{t("auth.oauth.google")}</Text>
              )}
            </TouchableOpacity>
            )}

            {!JEN_RIQ_ID && (
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>{t("common.or")}</Text>
                <View style={styles.dividerLine} />
              </View>
            )}

            <TouchableOpacity
              style={[styles.oauthButton, { backgroundColor: colors.primary + "20", borderColor: colors.primary }]}
              onPress={() => (JEN_RIQ_ID ? zacniWebView() : handleOAuthLogin("keycloak"))}
              disabled={isLoading}
              testID="auth-oauth-keycloak"
            >
              {isLoading ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <>
                  <Shield size={18} color={colors.primary} />
                  <Text style={[styles.oauthButtonText, { color: colors.primary }]}>
                    {t("auth.oauth.keycloak")}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <PrihlaseniWebView
        viditelne={webview}
        onHotovo={poWebView}
        onChyba={chybaWebView}
        onZavrit={() => setWebview(false)}
      />

      {/* Biometric — hidden while the feature is off, so nobody can re-enter the loop by hand. */}
      {BIOMETRIC_ENABLED && biometric.isEnabled && biometric.isEnrolled && (
        <TouchableOpacity
          testID="login-biometric-btn"
          style={styles.biometricButton}
          onPress={handleBiometricUnlock}
        >
          <Fingerprint size={24} color={colors.primary} />
          <Text style={styles.biometricText}>
            {t("auth.biometric_unlock").replace("{name}", biometric.biometricName)}
          </Text>
        </TouchableOpacity>
      )}

      {/* Footer — na Androidu ne: účty řidičům zakládá správce a registrace jde přes prohlížeč. */}
      {!JEN_RIQ_ID && (
        <View style={styles.footer}>
          <Text style={styles.footerText}>{t("auth.login.noAccount")} </Text>
          <TouchableOpacity
            onPress={() => router.push("/(auth)/register")}
            testID="auth-go-register"
          >
            <Text style={styles.footerLink}>{t("auth.login.register")}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/*
        ⛔ CESTA VEN Z CIHLY (zadání majitele, 2026-08-20): *„můžeme to zařízení
        udělat neautorizovaným a nešlo by se dostat do režimu mít možnost
        zaťukat ručně."*

        Naměřeno 2026-08-20: jediná cesta k ručnímu ťukání vedla z banneru
        v `kroky.tsx`, a ten se rozsvítí až po NEÚSPĚŠNÉM ODESLÁNÍ — tedy až
        když je člověk přihlášený. V cílovém modelu se přitom zavírá PŘED
        přihlášením: kdo přijde s odvolaným pověřením, uvidí tenhle formulář,
        který se nemá kam připojit, a nic dalšího.

        ⚠️ TICHÝ ODKAZ, NE VÝZVA. Break-glass, který lidé vidí denně jako
        tlačítko, přestane být break-glass. Proto dole, malým, a formulací,
        která si najde jen toho, komu patří.
      */}
      <TouchableOpacity
        onPress={() => router.push("/zaklepat")}
        testID="auth-go-zaklepat"
        accessibilityRole="button"
        style={styles.dvere}
      >
        {/*
          ⭐ SYMBOL VEDLE TEXTU, NE MÍSTO NĚJ. Odkaz zůstává tichý (dole, malý,
          formulace si najde jen toho, komu patří) — ikona ho jen dělá
          ROZPOZNATELNÝM, aby si ho člověk spojil s toutéž věcí v appce.

          `DoorClosed`, ne `DoorOpen`: dveře jsou zavřené a teprve se na ně klepe.
          Otevřené dveře by slibovaly stav, který nastane až PO zaťukání — a to je
          přesně tvrzení, které tenhle systém nikde nedělá (dveře mlčí).
        */}
        <DoorClosed size={16} color={colors.textSecondary} />
        <Text style={styles.dvereText}>{t("knock.fromLogin")}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1, justifyContent: "center", padding: spacing.xl, backgroundColor: colors.background },
  header: { alignItems: "center", marginBottom: spacing.lg },
  title: { ...typography.h1, color: colors.primary },
  subtitle: { ...typography.bodySmall, textAlign: "center", marginTop: spacing.xs },
  // ⛔ NA TABLETU SE KARTA ROZTAHOVALA PŘES CELOU ŠÍŘKU (naměřeno na iPad Pro
  // 13": pole šla od kraje ke kraji). Je to PRVNÍ obrazovka, kterou člověk
  // uvidí. Strop se dává KARTĚ, ne obalu s pozadím — to má krýt celou plochu,
  // jinak vznikne uprostřed displeje ostrůvek. Viz lib/sirkaObsahu.
  card: {
    ...sloupec,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  cardHeader: { padding: spacing.lg, paddingBottom: 0 },
  cardTitle: { ...typography.h2, textAlign: "center", marginBottom: spacing.sm },
  form: { padding: spacing.lg, gap: spacing.md },
  errorBox: {
    backgroundColor: `${colors.error}20`,
    borderColor: colors.error,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  errorText: { color: colors.error, fontSize: 14, textAlign: "center" },
  diagToggle: {
    color: colors.textSecondary, fontSize: 12.5, fontWeight: "600",
    textAlign: "center", marginTop: spacing.sm,
  },
  diagBox: {
    marginTop: spacing.sm, padding: spacing.sm, borderRadius: 8,
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
  },
  // Selectable and monospaced: this text exists to be read carefully and pasted
  // into a message, not to be admired.
  diagLine: {
    color: colors.textMuted, fontSize: 11.5, lineHeight: 17,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: spacing.sm,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: {
    ...typography.caption,
    textTransform: "uppercase",
    paddingHorizontal: 12,
  },
  oauthContainer: { gap: 12 },
  oauthButton: {
    flexDirection: "row",
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceLight,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  oauthButtonText: { color: colors.text, fontSize: 15, fontWeight: "500" },
  biometricButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  biometricText: { ...typography.body, color: colors.primary, fontWeight: "600" },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: spacing.lg,
  },
  footerText: { ...typography.bodySmall },
  footerLink: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  // Dotyková plocha zůstává palcová (44 pt), i když je text tichý.
  dvere: {
    alignSelf: "center", marginTop: spacing.lg, minHeight: 44,
    justifyContent: "center", paddingHorizontal: spacing.md,
    // Ikona a text jsou JEDEN cíl dotyku — dvě odděleně klikatelné věci vedle
    // sebe by na telefonu znamenaly, že část zásahů mine.
    flexDirection: "row", alignItems: "center", gap: spacing.xs,
  },
  dvereText: { color: colors.textSecondary, fontSize: 14, textDecorationLine: "underline" },
});
