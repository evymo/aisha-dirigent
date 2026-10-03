/**
 * Root Layout — initializes Sentry, auth, query client, deep linking, offline.
 */
import { Component, type ErrorInfo, type ReactNode, useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { initSentry } from "@/config/sentry";
import { getApiConfigurationIssue, restoreEnvironment } from "@/config/api";
import { initLocale } from "@/hooks/useTranslation";
import { useDeepLinking } from "@/hooks/useDeepLinking";
import { useNotifications } from "@/hooks/useNotifications";
import { useSamoKlepaniKiosku } from "@/hooks/useSamoKlepaniKiosku";
import { useOffline } from "@/hooks/useOffline";
import { Klepatko } from "@/components";
import { useTranslation } from "@/hooks";
import { useObnovaPriNavratu } from "@/lib/oziveni";
import { safeError } from "@/lib/security/safeLogger";
import { NaturelProvider } from "@/naturel/NaturelProvider";
import { colors } from "@/theme";
import { nativeTrezorCrypto, nativeZdrojRelace } from "@/lib/knock-native";
import { nastavZdrojZarizeni, uzivatelZarizeni } from "@/lib/identitaZarizeni";
import { jeKiosk } from "@/config/knock";
import { EsdkProvider, ESDK_BRAND, ESDK_TEMA } from "@/extranet/esdk";
import { nativeDeps } from "@/services/trezorStore";
import { setIdentityProvider, setTrezorDeps } from "@/services/offline";
import { getUser } from "@/config/oidc";

// Initialize Sentry before anything else
initSentry();

/**
 * Zapojení trezoru — offline fronta od téhle chvíle leží na disku ZAMČENÁ.
 *
 * ⭐ PROČ TO STOJÍ TADY A NE UVNITŘ `services/offline`. Nativní krypto linkuje
 * `knock-native.ts`, který se schválně netahá do jestu; kdyby si ho fronta
 * importovala sama, celá testovací sada by přestala parsovat. Vazba je proto
 * VNĚJŠÍ a dosazuje ji appka na jednom místě, hned při startu — dřív, než se
 * kdokoli stihne fronty zeptat.
 *
 * ⛔ Bez tohohle řádku fronta VYHODÍ. Je to záměr: tichý pád zpátky na nezamčené
 * úložiště by vyrobil build, ve kterém šifrování mlčky neplatí a podpisy leží
 * v plaintextu.
 */
setTrezorDeps(nativeDeps(nativeTrezorCrypto()));

/**
 * Zapojení identity — fronta od téhle chvíle ví, ČÍ práci veze.
 *
 * ⭐ Sdílený telefon směny je běžný provoz, ne okrajový případ: řidič A
 * zaznamená předání offline, telefon převezme B a přihlásí se. Bez tohohle
 * řádku by se A práce odeslala pod účtem B a server by zapsal `completed_by = B`
 * k podpisu, který sbíral A — audit by tvrdil nepravdu o právním důkazu.
 *
 * ⛔ Vazba je VNĚJŠÍ ze stejného důvodu jako u trezoru: `config/oidc` tahá
 * `expo-linking` a statický import by rozbil celou testovací sadu.
 *
 * Bez tohohle řádku se cizí ani vlastní práce NEODESÍLÁ (fail-closed) — ale
 * ani neztratí. Tichý průchod „když nevím, tak pošli" je přesně ten nález.
 */
/**
 * Tablet v kiosku (F2) mluví za sebe relací SVÉHO účtu — bez přihlášeného člověka.
 * Zapojuje se jen tady (nativní kryptografie); mimo kiosk zůstává zdroj prázdný a telefon
 * s přihlášeným řidičem se chová přesně jako dřív. Identita fronty pak padá na účet
 * zařízení, jinak by předání zaznamenané na tabletu bez signálu nikdy neodešlo.
 */
if (jeKiosk()) nastavZdrojZarizeni(nativeZdrojRelace());
setIdentityProvider(async () => (await getUser())?.id ?? uzivatelZarizeni());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      staleTime: 5 * 60 * 1000,
    },
  },
});

interface StartupErrorBoundaryState {
  hasError: boolean;
}

function StartupFallback({
  configIssue,
  onRetry,
}: {
  configIssue: string | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.fallbackRoot} testID="startup-error-screen">
      <Text style={styles.fallbackTitle}>{t("startup.error_title")}</Text>
      <Text style={styles.fallbackSubtitle}>{t("startup.error_subtitle")}</Text>
      {configIssue ? (
        <Text style={styles.fallbackIssue} testID="startup-config-issue">
          {configIssue}
        </Text>
      ) : null}
      <Pressable onPress={onRetry} style={styles.fallbackButton} testID="startup-retry-btn">
        <Text style={styles.fallbackButtonText}>{t("common.retry")}</Text>
      </Pressable>
      {/*
        ⛔ BEZ TOHOHLE JE KLEPÁTKO NEDOSTUPNÉ PRÁVĚ TEHDY, KDY JE POTŘEBA.
        Zavřené dveře shodí start aplikace sem — a tahle obrazovka se kreslí
        MÍSTO `AppShell`, takže žádný `<Stack>` nestojí a `router.push` nemá kam
        jít. Samotné „Opakovat" je z cizí IP nekonečná smyčka: načtení nemůže
        uspět, dokud se nezaťuká. Změřeno na simulátoru 2026-09-06.
      */}
      <Klepatko onHotovo={onRetry} />
    </View>
  );
}

class StartupErrorBoundary extends Component<{ children: ReactNode }, StartupErrorBoundaryState> {
  public state: StartupErrorBoundaryState = {
    hasError: false,
  };

  public static getDerivedStateFromError(): StartupErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    safeError(
      "StartupErrorBoundary",
      new Error(
        `${error.message}\n${errorInfo.componentStack ?? "no-component-stack"}`
      )
    );
  }

  private retry = () => {
    this.setState({ hasError: false });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <StartupFallback
          configIssue={getApiConfigurationIssue()}
          onRetry={this.retry}
        />
      );
    }

    return this.props.children;
  }
}

/** Inner component to use hooks inside QueryClientProvider. */
function AppShell() {
  const { t } = useTranslation();

  // Initialize deep linking resolver
  useDeepLinking();

  // Initialize push token lifecycle in background.
  useNotifications();
  // Tablet v kiosku drží dveře otevřené sám (UDP dávka + ověření, odstup).
  useSamoKlepaniKiosku();

  // Monitor network state + process offline queue on reconnect
  useOffline();
  /**
   * ⛔ BEZ TOHOHLE JE `refetchOnWindowFocus` NAPRÁZDNO. V React Native není
   * okno, které by ohnisko hlásilo, takže se data po odemčení telefonu
   * neobnovila NIKDY — řidič viděl ranní stav i po čtyřicetiminutové jízdě.
   */
  useObnovaPriNavratu();

  useEffect(() => {
    // Restore persisted environment before auth checks
    restoreEnvironment().then(() => initLocale());
  }, []);

  return (
    <NaturelProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="porada" options={{ headerShown: false }} />
        <Stack.Screen name="kroky" options={{ headerShown: false }} />
        <Stack.Screen name="kiosk" options={{ headerShown: false }} />
        <Stack.Screen
          name="settings"
          options={{
            title: t("settings.title"),
            presentation: "modal",
          }}
        />
        <Stack.Screen
          name="naturel-calibration"
          options={{
            title: t("naturel.calibration.doneOverline"),
            headerBackTitle: t("common.back"),
          }}
        />
        <Stack.Screen
          name="naturel-style"
          options={{
            title: t("naturel.style.title"),
            headerBackTitle: t("common.back"),
          }}
        />
        <Stack.Screen
          name="project/[id]"
          options={{
            title: "",
            headerBackTitle: t("common.back"),
          }}
        />
        <Stack.Screen
          name="conversations"
          options={{
            title: t("projects.conversations"),
            presentation: "modal",
          }}
        />
        <Stack.Screen
          name="chat"
          options={{
            title: t("chat.title"),
            headerBackTitle: t("common.back"),
          }}
        />
        <Stack.Screen
          name="validator"
          options={{
            title: t("validator.title"),
            presentation: "modal",
          }}
        />
        <Stack.Screen
          name="questionnaire/[id]"
          options={{
            title: t("questionnaire.title"),
            headerBackTitle: t("common.back"),
          }}
        />
        <Stack.Screen
          name="questionnaires"
          options={{
            title: t("questionnaire.list_title"),
            presentation: "modal",
          }}
        />
      </Stack>
    </NaturelProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        {/* Jazyk ESDK v tématu APPKY (tmavé), ne ve výchozím světlém — viz esdk.tsx.
            Obaluje i záchytnou obrazovku startu, ať má tentýž motiv. */}
        <EsdkProvider brand={ESDK_BRAND} theme={ESDK_TEMA}>
          <QueryClientProvider client={queryClient}>
            <StartupErrorBoundary>
              <AppShell />
            </StartupErrorBoundary>
          </QueryClientProvider>
        </EsdkProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  fallbackRoot: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  fallbackTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  fallbackSubtitle: {
    color: colors.textSecondary,
    fontSize: 15,
    textAlign: "center",
  },
  fallbackIssue: {
    color: colors.error,
    textAlign: "center",
    fontSize: 13,
  },
  fallbackButton: {
    marginTop: 8,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  fallbackButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
});
