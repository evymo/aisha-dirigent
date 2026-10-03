/**
 * Přihlášení Řidiče na Androidu ve VLOŽENÉM WebView — jen jménem a heslem RIQ ID.
 *
 * ⭐ ROZHODNUTÍ MAJITELE (2026-09-28): tablety v kiosku nemají prohlížeč ani
 * Google Play; přihlášení běží uvnitř appky. Žádost (PKCE) připraví oidc,
 * o navigaci a návratu rozhoduje čistá logika v src/lib/prihlaseniWebView.ts.
 *
 * ⛔ `originWhitelist={["*"]}` NENÍ povolení všeho: bez něj by WebView adresu
 *    mimo seznam otevřel přes Linking (návrat na redirect by šel mimo tuhle
 *    obrazovku, cizí web do systému). Takhle jde KAŽDÁ navigace přes
 *    `rozhodniNavigaci` — a ta pustí jen realm RIQ ID.
 * ⛔ `incognito`: sdílený tablet si přihlášení nepamatuje v cookies; relaci drží
 *    tokeny appky (offline_access), odhlášení ji ukončí na serveru.
 */
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { WebView } from "react-native-webview";
import { authService } from "@/services/auth";
import { useTranslation } from "@/hooks";
import { colors, spacing, typography } from "@/theme";
import { prectiNavrat, rozhodniNavigaci, SKRYT_JINE_ZPUSOBY, type CilPrihlaseni } from "@/lib/prihlaseniWebView";
import { safeWarn } from "@/lib/security/safeLogger";

interface Zadost {
  url: string;
  state: string;
  codeVerifier: string;
  cil: CilPrihlaseni;
}

export function PrihlaseniWebView({
  viditelne,
  onHotovo,
  onChyba,
  onZavrit,
}: {
  viditelne: boolean;
  onHotovo: () => void;
  onChyba: (chyba: Error) => void;
  onZavrit: () => void;
}) {
  const { t } = useTranslation();
  const [zadost, setZadost] = useState<Zadost | null>(null);
  const [blokovano, setBlokovano] = useState(false);
  const [dokoncuji, setDokoncuji] = useState(false);
  const vyrizeno = useRef(false);

  useEffect(() => {
    if (!viditelne) {
      setZadost(null);
      setBlokovano(false);
      setDokoncuji(false);
      vyrizeno.current = false;
      return;
    }
    let zruseno = false;
    authService
      .pripravPrihlaseniWebView()
      .then((z) => {
        if (!zruseno) setZadost(z);
      })
      .catch((e: unknown) => {
        if (!zruseno) onChyba(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      zruseno = true;
    };
  }, [viditelne, onChyba]);

  const naNavigaci = (pozadavek: { url: string }): boolean => {
    if (!zadost) return false;
    const rozhodnuti = rozhodniNavigaci(pozadavek.url, zadost.cil);
    if (rozhodnuti === "povolit") return true;
    if (rozhodnuti === "navrat") {
      // Návrat přijde jednou; druhé volání (např. opakované načtení) se ignoruje.
      if (vyrizeno.current) return false;
      vyrizeno.current = true;
      const navrat = prectiNavrat(pozadavek.url, zadost.state);
      if ("error" in navrat) {
        onChyba(new Error(`Login failed: ${navrat.error}`));
        return false;
      }
      setDokoncuji(true);
      authService
        .dokonciPrihlaseniWebView(navrat.code, zadost.codeVerifier)
        .then(() => onHotovo())
        .catch((e: unknown) => onChyba(e instanceof Error ? e : new Error(String(e))));
      return false;
    }
    safeWarn("Login.webview.blocked_navigation");
    setBlokovano(true);
    return false;
  };

  return (
    <Modal visible={viditelne} animationType="slide" onRequestClose={onZavrit}>
      <View style={styles.obal}>
        <View style={styles.hlavicka}>
          <Text style={styles.titulek}>{t("auth.webview.title")}</Text>
          <TouchableOpacity onPress={onZavrit} testID="prihlaseni-webview-zavrit">
            <Text style={styles.zavrit}>{t("common.cancel")}</Text>
          </TouchableOpacity>
        </View>
        {blokovano && (
          <Text style={styles.blokovano} testID="prihlaseni-webview-blokovano">
            {t("auth.webview.blocked")}
          </Text>
        )}
        {zadost && !dokoncuji ? (
          <WebView
            source={{ uri: zadost.url }}
            originWhitelist={["*"]}
            onShouldStartLoadWithRequest={naNavigaci}
            injectedJavaScriptBeforeContentLoaded={SKRYT_JINE_ZPUSOBY}
            incognito
            setSupportMultipleWindows={false}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            testID="prihlaseni-webview"
          />
        ) : (
          <View style={styles.cekani}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  obal: { flex: 1, backgroundColor: colors.background },
  hlavicka: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  titulek: { ...typography.h3, color: colors.text },
  zavrit: { ...typography.body, color: colors.primary },
  blokovano: { ...typography.body, color: colors.error, padding: spacing.md },
  cekani: { flex: 1, alignItems: "center", justifyContent: "center" },
});
