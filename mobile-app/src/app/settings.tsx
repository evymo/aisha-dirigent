/**
 * Settings screen — environment picker, language, push, about.
 */
import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
} from "react-native";
import Constants from "expo-constants";
import { router } from "expo-router";
import {
  ENV_PRESETS,
  checkBackendHealth,
  getActiveEnvironmentId,
  getBackendUrl,
  getAnonKey,
  isGatewayPinned,
  switchEnvironment,
} from "@/config/api";
import type { EnvironmentId } from "@/config/api";
import { useAuth, useNotifications, useTranslation } from "@/hooks";
import { colors, spacing, typography } from "@/theme";
import { safeInfo } from "@/lib/security/safeLogger";

export default function SettingsScreen() {
  const { t, locale, setLocale } = useTranslation();
  const { signOut } = useAuth();
  const { requestPermission, permissionGranted } = useNotifications({ initialize: false });

  const [selectedEnv, setSelectedEnv] = useState<EnvironmentId>(getActiveEnvironmentId());
  const [customUrl, setCustomUrl] = useState("");
  const [customAnonKey, setCustomAnonKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [switching, setSwitching] = useState(false);

  // Load current values for custom fields
  useEffect(() => {
    (async () => {
      try {
        const currentEnv = getActiveEnvironmentId();
        setSelectedEnv(currentEnv);
        if (currentEnv === "custom") {
          setCustomUrl(await getBackendUrl());
          setCustomAnonKey(await getAnonKey());
        }
      } catch {
        // defaults are fine
      }
    })();
  }, []);

  const activeUrl = selectedEnv === "custom"
    ? customUrl
    : ENV_PRESETS[selectedEnv].url;

  const handleTestConnection = useCallback(async () => {
    const urlToTest = selectedEnv === "custom" ? customUrl : ENV_PRESETS[selectedEnv].url;
    if (!urlToTest) return;
    setTesting(true);
    setTestResult(null);
    const ok = await checkBackendHealth(urlToTest);
    setTestResult(ok);
    setTesting(false);
  }, [selectedEnv, customUrl]);

  const handleSwitchEnv = useCallback(async () => {
    setSwitching(true);
    try {
      await switchEnvironment(
        selectedEnv,
        selectedEnv === "custom" ? customUrl : undefined,
        selectedEnv === "custom" ? customAnonKey : undefined,
      );
      safeInfo("Settings.environment_switched", { envId: selectedEnv });
      Alert.alert(
        t("settings.env_switched"),
        t("settings.env_switched_desc"),
        [{ text: "OK", onPress: () => router.replace("/(auth)/login") }],
      );
    } catch (error) {
      Alert.alert(t("errors.title"), String(error));
    } finally {
      setSwitching(false);
    }
  }, [selectedEnv, customUrl, customAnonKey, t]);

  const handleLogout = useCallback(async () => {
    await signOut();
    router.replace("/(auth)/login");
  }, [signOut]);

  const version = Constants.expoConfig?.version ?? "1.0.0";
  // Dedicated company build → gateway fixed → hide the whole switcher, show the URL read-only.
  const pinned = isGatewayPinned();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} testID="settings-screen">
      {/* Environment Picker */}
      <Text style={styles.sectionTitle}>{t("settings.environment")}</Text>

      {!pinned && (["local", "cloud", "custom"] as const).map((envId) => {
        const isActive = selectedEnv === envId;
        const label = envId === "custom"
          ? t("settings.env_custom")
          : ENV_PRESETS[envId].label;
        const subtitle = envId === "custom"
          ? (customUrl || t("settings.env_custom_hint"))
          : ENV_PRESETS[envId].url;

        return (
          <TouchableOpacity
            key={envId}
            testID={`settings-env-${envId}`}
            style={[styles.envCard, isActive && styles.envCardActive]}
            onPress={() => {
              setSelectedEnv(envId);
              setTestResult(null);
            }}
          >
            <View style={styles.envCardHeader}>
              <View style={[styles.envRadio, isActive && styles.envRadioActive]} />
              <Text style={[styles.envLabel, isActive && styles.envLabelActive]}>
                {label}
              </Text>
            </View>
            <Text style={styles.envUrl}>{subtitle}</Text>
          </TouchableOpacity>
        );
      })}

      {/* Custom URL fields (shown when custom is selected) */}
      {!pinned && selectedEnv === "custom" && (
        <View style={styles.customFields}>
          <TextInput
            testID="settings-custom-url-input"
            style={styles.input}
            placeholder="https://api.example.com"
            placeholderTextColor={colors.textMuted}
            value={customUrl}
            onChangeText={setCustomUrl}
            autoCapitalize="none"
            keyboardType="url"
          />
          <TextInput
            testID="settings-custom-anon-key-input"
            style={styles.input}
            placeholder={t("settings.anon_key")}
            placeholderTextColor={colors.textMuted}
            value={customAnonKey}
            onChangeText={setCustomAnonKey}
            autoCapitalize="none"
            secureTextEntry
          />
        </View>
      )}

      {/* Actions */}
      {!pinned && (
        <View style={styles.row}>
          <TouchableOpacity
            style={styles.buttonSmall}
            onPress={handleTestConnection}
            testID="settings-test-connection-btn"
          >
            {testing ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Text style={styles.buttonSmallText}>{t("settings.test_connection")}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.buttonSmall, styles.buttonPrimary]}
            onPress={handleSwitchEnv}
            disabled={switching}
            testID="settings-switch-env-btn"
          >
            {switching ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Text style={styles.buttonSmallText}>{t("settings.apply_environment")}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {!pinned && testResult !== null && (
        <Text style={[styles.testResult, { color: testResult ? colors.success : colors.error }]}>
          {testResult ? t("settings.connection_ok") : t("settings.connection_failed")}
        </Text>
      )}

      {/* Current Environment Info — always shown (read-only URL for a pinned build) */}
      <Text style={styles.currentEnvText}>
        {t("settings.current_env")}: {activeUrl}
      </Text>

      {/* Naturel — how Aisha talks with me (style is the user's own, E2/E3) */}
      <Text style={styles.sectionTitle}>{t("naturel.style.title")}</Text>
      <TouchableOpacity
        style={styles.row}
        testID="settings-naturel-style"
        onPress={() => router.push("/naturel-style")}
      >
        <Text style={styles.settingLabel}>{t("naturel.style.howNow")} →</Text>
      </TouchableOpacity>

      {/* Language */}
      <Text style={styles.sectionTitle}>{t("settings.language")}</Text>
      <View style={styles.row}>
        {["cs", "en"].map((lang) => (
          <TouchableOpacity
            key={lang}
            testID={`settings-language-${lang}`}
            style={[styles.langButton, locale === lang && styles.langButtonActive]}
            onPress={() => setLocale(lang)}
          >
            <Text
              style={[
                styles.langButtonText,
                locale === lang && styles.langButtonTextActive,
              ]}
            >
              {lang.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Notifications */}
      <Text style={styles.sectionTitle}>{t("settings.notifications")}</Text>
      <View style={styles.settingRow}>
        <Text style={styles.settingLabel}>{t("settings.enable_push")}</Text>
        <Switch
          value={permissionGranted}
          onValueChange={() => { requestPermission(); }}
          trackColor={{ false: colors.surfaceLight, true: colors.primary }}
        />
      </View>

      {/* About */}
      <Text style={styles.sectionTitle}>{t("settings.about")}</Text>
      <Text style={styles.aboutText}>
        {t("settings.version")}: {version}
      </Text>

      {/* Logout */}
      <TouchableOpacity
        style={styles.logoutButton}
        onPress={handleLogout}
        testID="settings-logout-btn"
      >
        <Text style={styles.logoutText}>{t("common.logout")}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  sectionTitle: {
    ...typography.label,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  envCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  envCardActive: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  envCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  envRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.textMuted,
  },
  envRadioActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  envLabel: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: "600",
  },
  envLabelActive: {
    color: colors.text,
  },
  envUrl: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 4,
    marginLeft: 26,
  },
  customFields: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
    color: colors.text,
    fontSize: 14,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  buttonSmall: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    padding: spacing.sm,
    alignItems: "center",
  },
  buttonPrimary: {
    backgroundColor: colors.primary,
  },
  buttonSmallText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "500",
  },
  testResult: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: spacing.xs,
  },
  currentEnvText: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  langButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  langButtonActive: {
    backgroundColor: colors.primary,
  },
  langButtonText: {
    color: colors.textSecondary,
    fontWeight: "600",
  },
  langButtonTextActive: {
    color: colors.text,
  },
  settingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: spacing.md,
  },
  settingLabel: {
    ...typography.body,
    fontSize: 14,
  },
  aboutText: {
    ...typography.bodySmall,
  },
  logoutButton: {
    marginTop: spacing.xl,
    backgroundColor: `${colors.error}20`,
    borderColor: colors.error,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
    alignItems: "center",
  },
  logoutText: {
    color: colors.error,
    fontSize: 16,
    fontWeight: "600",
  },
});
