/**
 * Root index — redirects to auth or tabs based on session state.
 * First authenticated entry routes through the naturel Z6 calibration until the
 * user either saves a style or explicitly skips (both persist server-side, so
 * the flow never nags again — Z6: skipping is legitimate).
 */
import { Redirect } from "expo-router";
import { useAuth } from "@/hooks";
import { ActivityIndicator, View } from "react-native";
import { colors } from "@/theme";
import { useNaturel } from "@/naturel/NaturelProvider";
import { resolveLandingRoute } from "@/extranet/surfaceRouting";
import { jeKiosk } from "@/config/knock";

export default function Index() {
  const { isLoading, isAuthenticated, user } = useAuth();
  const { decided, loading: naturelLoading } = useNaturel();

  if (isLoading || (isAuthenticated && naturelLoading)) {
    return (
      <View
        style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background }}
        testID="app-loading-screen"
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isAuthenticated) {
    if (!decided) {
      return <Redirect href="/naturel-calibration" />;
    }
    // Default surface by brand + role: extranet Porada for non-admin/staff on a
    // build that opts in; member tabs otherwise. Tabs stay reachable either way.
    return <Redirect href={resolveLandingRoute(user?.roles)} />;
  }

  // Tablet v kiosku (F2): bez člověka rovnou dnešní rozvozy — přihlásit se jde odtamtud
  // (servis, technik). Telefon mimo kiosk jde na přihlášení jako dřív.
  if (jeKiosk()) return <Redirect href="/kiosk" />;

  return <Redirect href="/(auth)/login" />;
}
