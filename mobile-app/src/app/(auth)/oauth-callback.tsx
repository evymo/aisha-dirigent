/**
 * OAuth Callback Screen
 *
 * With Keycloak OIDC via expo-auth-session, the token exchange
 * happens within the login() call itself. This screen only exists
 * as a deep link target that redirects the user after the browser
 * flow completes.
 *
 * URL format: aisha-dirigent://oauth-callback
 */
import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { CheckCircle, XCircle } from "lucide-react-native";
import { isLoggedIn } from "@/config/oidc";
import { useTranslation } from "@/hooks";
import { safeInfo, safeWarn } from "@/lib/security/safeLogger";
import { colors, spacing, typography } from "@/theme";

type CallbackStatus = "processing" | "success" | "error";

export default function OAuthCallbackScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [status, setStatus] = useState<CallbackStatus>("processing");

  useEffect(() => {
    const check = async () => {
      // Give expo-auth-session a moment to complete token exchange
      await new Promise((resolve) => setTimeout(resolve, 500));

      const loggedIn = await isLoggedIn();
      if (loggedIn) {
        safeInfo("OAuth.callback.session_found");
        setStatus("success");
        // Root, not tabs: it owns the landing decision (calibration, then the
        // brand's default surface by role).
        setTimeout(() => router.replace("/"), 800);
      } else {
        safeWarn("OAuth.callback.no_session");
        setStatus("error");
        setTimeout(() => router.replace("/(auth)/login"), 2000);
      }
    };

    check();
  }, [router]);

  return (
    <View style={styles.container} testID="oauth-callback-screen">
      <View style={styles.content}>
        {status === "processing" && (
          <>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.message}>{t("auth.oauth.processing")}</Text>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle size={64} color={colors.success} />
            <Text style={[styles.message, { color: colors.success }]}>
              {t("auth.oauth.success")}
            </Text>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle size={64} color={colors.error} />
            <Text style={[styles.message, { color: colors.error }]}>
              {t("auth.oauth.redirecting_back")}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  message: {
    ...typography.h3,
    textAlign: "center",
    marginTop: spacing.md,
  },
});
