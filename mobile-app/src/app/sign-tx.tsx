/**
 * Sign Transaction Screen — generic biometric-gated Cosmos tx signing.
 *
 * Receives params via route: { messages, memo, rpcEndpoint? }
 * Used by governance, reward claims, and any future on-chain action.
 */
import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
} from "react-native";
import { Stack, useLocalSearchParams, router } from "expo-router";
import { useTranslation } from "@/hooks";
import { useCosmosWallet } from "@/hooks/useCosmosWallet";
import { colors, spacing } from "@/theme";
import { Shield, CheckCircle, XCircle } from "lucide-react-native";

const DEFAULT_RPC = process.env.EXPO_PUBLIC_COSMOS_RPC ?? "";

type TxStatus = "idle" | "signing" | "success" | "error";

export default function SignTxScreen() {
  const { t } = useTranslation();
  const wallet = useCosmosWallet();
  const params = useLocalSearchParams<{
    messages: string; // JSON-serialized array of { typeUrl, value }
    memo?: string;
    rpcEndpoint?: string;
  }>();

  const [status, setStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const messages = (() => {
    try {
      return JSON.parse(params.messages ?? "[]");
    } catch {
      return [];
    }
  })();

  const handleSign = async () => {
    if (!wallet.isInitialized) {
      Alert.alert(t("wallet.required"));
      return;
    }

    setStatus("signing");
    try {
      const result = await wallet.signAndBroadcast(
        params.rpcEndpoint ?? DEFAULT_RPC,
        messages,
        params.memo,
      );

      if (result.code === 0) {
        setStatus("success");
        setTxHash(result.transactionHash);
      } else {
        setStatus("error");
        setErrorMsg(result.rawLog ?? "Transaction failed");
      }
    } catch (e: unknown) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Signing failed");
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: t("signTx.title"), presentation: "modal" }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.center}>
          <Shield size={48} color={colors.primary} />
          <Text style={styles.heading}>{t("signTx.heading")}</Text>
          <Text style={styles.sub}>{t("signTx.description")}</Text>
        </View>

        {/* Transaction summary */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>{t("signTx.messages")}</Text>
          <Text style={styles.summaryValue}>
            {messages.length} message{messages.length !== 1 ? "s" : ""}
          </Text>
          {params.memo && (
            <>
              <Text style={styles.summaryLabel}>{t("signTx.memo")}</Text>
              <Text style={styles.summaryValue}>{params.memo}</Text>
            </>
          )}
        </View>

        {/* Status display */}
        {status === "idle" && (
          <TouchableOpacity style={styles.signBtn} onPress={handleSign}>
            <Shield size={20} color={colors.text} />
            <Text style={styles.signBtnText}>{t("signTx.sign")}</Text>
          </TouchableOpacity>
        )}

        {status === "signing" && (
          <View style={styles.statusBox}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.statusText}>{t("signTx.signing")}</Text>
          </View>
        )}

        {status === "success" && (
          <View style={styles.statusBox}>
            <CheckCircle size={48} color={colors.success} />
            <Text style={[styles.statusText, { color: colors.success }]}>
              {t("signTx.success")}
            </Text>
            <Text style={styles.hashText}>{txHash?.slice(0, 24)}…</Text>
            <TouchableOpacity style={styles.doneBtn} onPress={() => router.back()}>
              <Text style={styles.doneBtnText}>{t("common.done")}</Text>
            </TouchableOpacity>
          </View>
        )}

        {status === "error" && (
          <View style={styles.statusBox}>
            <XCircle size={48} color={colors.error} />
            <Text style={[styles.statusText, { color: colors.error }]}>
              {t("signTx.failed")}
            </Text>
            <Text style={styles.errorText}>{errorMsg}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => setStatus("idle")}>
              <Text style={styles.retryBtnText}>{t("common.retry")}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  center: { alignItems: "center", marginTop: spacing.xl },

  heading: { color: colors.text, fontSize: 22, fontWeight: "700", marginTop: spacing.md },
  sub: { color: colors.textSecondary, fontSize: 14, textAlign: "center", marginTop: spacing.xs },

  summaryCard: {
    backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md,
    marginTop: spacing.lg,
  },
  summaryLabel: { color: colors.textMuted, fontSize: 11, textTransform: "uppercase", marginTop: spacing.sm },
  summaryValue: { color: colors.text, fontSize: 14, marginTop: 2 },

  signBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 16,
    gap: spacing.sm, marginTop: spacing.lg,
  },
  signBtnText: { color: colors.text, fontWeight: "700", fontSize: 18 },

  statusBox: { alignItems: "center", marginTop: spacing.xl },
  statusText: { color: colors.text, fontSize: 18, fontWeight: "600", marginTop: spacing.md },
  hashText: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.xs },
  errorText: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.xs, textAlign: "center" },

  doneBtn: {
    backgroundColor: colors.success, borderRadius: 12, paddingVertical: 14,
    paddingHorizontal: 40, marginTop: spacing.lg,
  },
  doneBtnText: { color: colors.text, fontWeight: "600", fontSize: 16 },

  retryBtn: {
    backgroundColor: colors.surface, borderRadius: 12, paddingVertical: 14,
    paddingHorizontal: 40, marginTop: spacing.md,
  },
  retryBtnText: { color: colors.text, fontWeight: "600" },
});
