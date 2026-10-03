/**
 * Registration Screen
 *
 * Email/password signup + OAuth (Apple, Google).
 * After successful signup, redirects to login.
 */
import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Mail, Lock, User, LogIn } from "lucide-react-native";
import { authService } from "@/services/auth";
import type { AuthProvider } from "@/services/auth";
import { useTranslation } from "@/hooks";
import { safeError, safeInfo } from "@/lib/security/safeLogger";
import { colors, spacing, typography } from "@/theme";
import { sloupec } from "@/lib/sirkaObsahu";

export default function RegisterScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleEmailRegister = async () => {
    if (!email || !password || !fullName) {
      Alert.alert(t("common.error"), t("auth.validation.fill_all_fields"));
      return;
    }
    if (password.length < 8) {
      Alert.alert(t("common.error"), t("auth.validation.password_length"));
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert(t("common.error"), t("auth.validation.passwords_mismatch"));
      return;
    }

    setLoading(true);
    safeInfo("Register.email.attempt");
    try {
      await authService.signUpWithEmail({ email, fullName, password });
      safeInfo("Register.email.success");
      Alert.alert(t("auth.success_title"), t("auth.registration_success_desc"), [
        { text: t("common.ok"), onPress: () => router.replace("/(auth)/login") },
      ]);
    } catch (error) {
      safeError("Register.email.error", error);
      Alert.alert(t("auth.registration_error_title"), t("auth.registration_error_desc"));
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthRegister = async (provider: AuthProvider) => {
    setLoading(true);
    safeInfo("Register.oauth.attempt", { provider });
    try {
      await authService.signInWithOAuth(provider);
    } catch (error) {
      safeError("Register.oauth.error", error);
      Alert.alert(t("auth.login_error_title"), t("common.try_again"));
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      testID="auth-register-screen"
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{t("common.app_name")}</Text>
          <Text style={styles.subtitle}>{t("auth.register.subtitle")}</Text>
        </View>

        {/* Card */}
        <View style={styles.card}>
          {/* Email form */}
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t("auth.register.full_name")}</Text>
              <View style={styles.inputWrapper}>
                <User size={18} color={colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.inputInner}
                  placeholder={t("auth.register.full_name_placeholder")}
                  placeholderTextColor={colors.textMuted}
                  value={fullName}
                  onChangeText={setFullName}
                  autoCapitalize="words"
                  autoComplete="name"
                  testID="auth-name-input"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t("auth.email")}</Text>
              <View style={styles.inputWrapper}>
                <Mail size={18} color={colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.inputInner}
                  placeholder={t("auth.email")}
                  placeholderTextColor={colors.textMuted}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  testID="auth-email-input"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t("auth.password")}</Text>
              <View style={styles.inputWrapper}>
                <Lock size={18} color={colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.inputInner}
                  placeholder={t("auth.password")}
                  placeholderTextColor={colors.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="password-new"
                  testID="auth-password-input"
                />
              </View>
              <Text style={styles.hint}>{t("auth.register.password_hint")}</Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t("auth.register.confirm_password")}</Text>
              <View style={styles.inputWrapper}>
                <Lock size={18} color={colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.inputInner}
                  placeholder={t("auth.password")}
                  placeholderTextColor={colors.textMuted}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="password-new"
                  testID="auth-confirm-password-input"
                />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
              onPress={handleEmailRegister}
              disabled={loading}
              testID="auth-register-submit"
            >
              {loading ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <>
                  <LogIn size={18} color={colors.text} style={{ marginRight: 8 }} />
                  <Text style={styles.primaryButtonText}>{t("auth.register.submit")}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* OAuth Divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>{t("auth.oauth.divider")}</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* OAuth Buttons */}
          <View style={styles.oauthContainer}>
            {Platform.OS === "ios" && (
              <TouchableOpacity
                style={[styles.oauthButton, { backgroundColor: "#000" }]}
                onPress={() => handleOAuthRegister("apple")}
                disabled={loading}
                testID="auth-oauth-apple"
              >
                <LogIn size={20} color="#fff" />
                <Text style={[styles.oauthButtonText, { color: "#fff" }]}>
                  {t("auth.oauth.apple")}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.oauthButton}
              onPress={() => handleOAuthRegister("google")}
              disabled={loading}
              testID="auth-oauth-google"
            >
              <LogIn size={20} color={colors.text} />
              <Text style={styles.oauthButtonText}>{t("auth.oauth.google")}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>{t("auth.register.have_account")} </Text>
          <TouchableOpacity
            onPress={() => router.push("/(auth)/login")}
            disabled={loading}
            testID="auth-go-login"
          >
            <Text style={styles.footerLink}>{t("auth.register.login_link")}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1, justifyContent: "center", padding: spacing.xl },
  header: { alignItems: "center", marginBottom: spacing.lg },
  title: { ...typography.h1, color: colors.primary },
  subtitle: { ...typography.bodySmall, marginTop: spacing.xs, textAlign: "center" },
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
  form: { padding: spacing.lg, gap: spacing.md },
  inputGroup: { gap: spacing.xs },
  label: { ...typography.label },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    height: 48,
    borderWidth: 1,
    borderRadius: 12,
    borderColor: colors.border,
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: 12,
  },
  inputIcon: { marginRight: 10 },
  inputInner: { flex: 1, fontSize: 16, height: "100%", color: colors.text },
  hint: { ...typography.caption, marginTop: 2 },
  primaryButton: {
    flexDirection: "row",
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    marginTop: spacing.sm,
  },
  primaryButtonText: { color: colors.text, fontSize: 16, fontWeight: "600" },
  buttonDisabled: { opacity: 0.7 },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: {
    ...typography.caption,
    textTransform: "uppercase",
    paddingHorizontal: 12,
  },
  oauthContainer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: 12 },
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
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: spacing.lg,
  },
  footerText: { ...typography.bodySmall },
  footerLink: { color: colors.primary, fontSize: 14, fontWeight: "600" },
});
