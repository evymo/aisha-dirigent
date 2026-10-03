/**
 * Wallet Tab — AISHA Cosmos wallet management + transaction history.
 *
 * Features:
 * - Create / Import wallet (BIP39 mnemonic)
 * - View address + balances
 * - Transaction history (from Supabase SoT)
 * - Sign governance votes (navigates to /governance)
 */
import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  StyleSheet,
} from "react-native";
import { router } from "expo-router";
import { useTranslation } from "@/hooks";
import { useAuth } from "@/hooks/useAuth";
import { useCosmosWallet } from "@/hooks/useCosmosWallet";
import { useEnsureCosmosAddressRegistered } from "@/hooks/useEnsureCosmosAddressRegistered";
import { useTokenTransactions } from "@/hooks/useTokenTransactions";
import { useMembership } from "@/hooks/useMembership";
import {
  useCommerceBaseCurrency,
  useLlmQuotaStatus,
  useMyProductAccess,
  useMySubscriptions,
  useSubscriptionPackages,
  useTokenRewardRules,
  useWalletBalance,
} from "@/hooks/useEntitlements";
import { formatMoney } from "@/lib/money";
import { colors, spacing } from "@/theme";
import {
  Wallet,
  Copy,
  Vote,
  ArrowDownToLine,
  Shield,
  Trash2,
  CreditCard,
  Package,
  BrainCircuit,
  Sparkles,
} from "lucide-react-native";
import * as Clipboard from "expo-clipboard";

export default function WalletScreen() {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const wallet = useCosmosWallet();
  // Push the wallet address to the backend profile so the stack can deliver rewards.
  useEnsureCosmosAddressRegistered(wallet.address, wallet.isInitialized);
  const membership = useMembership(user?.id);
  const transactions = useTokenTransactions(user?.id, { limit: 20 });
  const subscriptions = useMySubscriptions(user?.id);
  const productAccess = useMyProductAccess(user?.id);
  const packages = useSubscriptionPackages(locale);
  const baseCurrency = useCommerceBaseCurrency();
  const walletBalance = useWalletBalance(user?.id);
  const rewardRules = useTokenRewardRules(locale);
  const llmQuota = useLlmQuotaStatus(user?.id);
  const activeSub =
    (subscriptions.data ?? []).find((s) => s.status === "active") ??
    (subscriptions.data ?? [])[0] ??
    null;

  const [showImport, setShowImport] = useState(false);
  const [importMnemonic, setImportMnemonic] = useState("");
  const [backupMnemonic, setBackupMnemonic] = useState<string | null>(null);

  if (wallet.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // ── Wallet not initialized ──────────────────────────────────
  if (!wallet.isInitialized) {
    return (
      // ⭐ Bez testID se na obrazovku nedá v e2e chytit — a jako jediná ze čtyř
      // záložek ho neměla, takže scénář „přepni na peněženku" nešlo napsat
      // (naměřeno 2026-09-04).
      <ScrollView
        testID="wallet-screen"
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <View style={styles.hero}>
          <Wallet size={48} color={colors.primary} />
          <Text style={styles.heroTitle}>{t("wallet.setup.title")}</Text>
          <Text style={styles.heroSubtitle}>{t("wallet.setup.subtitle")}</Text>
        </View>

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={async () => {
            try {
              const mnemonic = await wallet.createWallet();
              setBackupMnemonic(mnemonic);
            } catch (e: unknown) {
              Alert.alert("Error", e instanceof Error ? e.message : "Failed to create wallet");
            }
          }}
        >
          <Text style={styles.primaryBtnText}>{t("wallet.setup.create")}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => setShowImport(true)}
        >
          <ArrowDownToLine size={18} color={colors.primary} />
          <Text style={styles.secondaryBtnText}>{t("wallet.setup.import")}</Text>
        </TouchableOpacity>

        {showImport && (
          <View style={styles.importBox}>
            <TextInput
              style={styles.mnemonicInput}
              placeholder={t("wallet.setup.mnemonicPlaceholder")}
              placeholderTextColor={colors.textMuted}
              multiline
              value={importMnemonic}
              onChangeText={setImportMnemonic}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={async () => {
                try {
                  await wallet.importWallet(importMnemonic);
                  setShowImport(false);
                  setImportMnemonic("");
                } catch (e: unknown) {
                  Alert.alert("Error", e instanceof Error ? e.message : "Invalid mnemonic");
                }
              }}
            >
              <Text style={styles.primaryBtnText}>{t("wallet.setup.confirmImport")}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Mnemonic backup modal */}
        {backupMnemonic && (
          <View style={styles.backupBox}>
            <Shield size={24} color={colors.warning} />
            <Text style={styles.backupTitle}>{t("wallet.backup.title")}</Text>
            <Text style={styles.backupWarning}>{t("wallet.backup.warning")}</Text>
            <View style={styles.mnemonicDisplay}>
              <Text style={styles.mnemonicText}>{backupMnemonic}</Text>
            </View>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => setBackupMnemonic(null)}
            >
              <Text style={styles.primaryBtnText}>{t("wallet.backup.done")}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    );
  }

  // ── Wallet initialized — main view ──────────────────────────
  const balances = membership.data
    ? [
        { label: "Governance", value: walletBalance.data?.governance_tokens ?? membership.data.tokens_governance ?? 0 },
        { label: "Impact", value: walletBalance.data?.impact_tokens ?? membership.data.tokens_impact ?? 0 },
        { label: "Data", value: walletBalance.data?.data_tokens ?? membership.data.tokens_data ?? 0 },
        { label: "AISHA", value: membership.data.tokens_aisha ?? 0 },
      ]
    : [];
  const quota = llmQuota.data;
  const quotaPct = quota && quota.daily_token_limit > 0
    ? Math.min(100, Math.round((quota.consumed_tokens_today / quota.daily_token_limit) * 100))
    : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Address card */}
      <View style={styles.addressCard}>
        <Wallet size={24} color={colors.primary} />
        <Text style={styles.addressLabel}>{t("wallet.address")}</Text>
        <TouchableOpacity
          style={styles.addressRow}
          onPress={() => {
            if (wallet.address) {
              Clipboard.setStringAsync(wallet.address);
              Alert.alert(t("wallet.copied"));
            }
          }}
        >
          <Text style={styles.addressText} numberOfLines={1} ellipsizeMode="middle">
            {wallet.address}
          </Text>
          <Copy size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Balances (from Supabase SoT) */}
      <View style={styles.balancesGrid}>
        {balances.map((b) => (
          <View key={b.label} style={styles.balanceCard}>
            <Text style={styles.balanceValue}>{b.value}</Text>
            <Text style={styles.balanceLabel}>{b.label}</Text>
          </View>
        ))}
      </View>

      {/* Actions */}
      <TouchableOpacity
        style={styles.actionBtn}
        onPress={() => router.push("/governance")}
      >
        <Vote size={20} color={colors.text} />
        <Text style={styles.actionBtnText}>{t("wallet.governance")}</Text>
      </TouchableOpacity>

      {/* Subscription & services (consumption) */}
      <Text style={styles.sectionTitle}>{t("services.title")}</Text>
      {activeSub ? (
        <View style={styles.svcCard}>
          <CreditCard size={18} color={colors.primary} />
          <View style={styles.svcBody}>
            <Text style={styles.svcName}>
              {activeSub.package_name ?? activeSub.package_tier ?? t("services.subscription")}
            </Text>
            {activeSub.next_billing_date ? (
              <Text style={styles.svcMeta}>
                {t("services.next_billing")}: {new Date(activeSub.next_billing_date).toLocaleDateString()}
              </Text>
            ) : null}
          </View>
          <View style={styles.svcBadge}>
            <Text style={styles.svcBadgeText}>{activeSub.status}</Text>
          </View>
        </View>
      ) : (
        <Text style={styles.emptyText}>{t("services.free_tier")}</Text>
      )}

      {quota ? (
        <View style={styles.svcCard}>
          <BrainCircuit size={18} color={colors.warning} />
          <View style={styles.svcBody}>
            <Text style={styles.svcName}>{t("services.llm_quota")}</Text>
            <Text style={styles.svcMeta}>
              {quota.remaining_tokens.toLocaleString()} {t("services.tokens_remaining")} · ${quota.remaining_cost_usd.toFixed(2)}
            </Text>
            <View style={styles.quotaBg}>
              <View style={[styles.quotaFill, { width: `${quotaPct}%` }]} />
            </View>
          </View>
          <View style={styles.svcBadge}>
            <Text style={styles.svcBadgeText}>{quota.tier}</Text>
          </View>
        </View>
      ) : null}

      {(productAccess.data ?? []).length > 0 && (
        <>
          <Text style={styles.svcSubTitle}>{t("services.product_access")}</Text>
          {(productAccess.data ?? []).map((p) => (
            <View key={p.id} style={styles.txRow}>
              <View style={styles.txLeft}>
                <Text style={styles.txType}>{p.access_type.replace(/_/g, " ")}</Text>
                {p.expires_at ? (
                  <Text style={styles.txDesc}>
                    {t("services.expires")}: {new Date(p.expires_at).toLocaleDateString()}
                  </Text>
                ) : null}
              </View>
              <Package size={16} color={colors.textSecondary} />
            </View>
          ))}
        </>
      )}

      {(packages.data ?? []).length > 0 && (
        <>
          <Text style={styles.svcSubTitle}>{t("services.packages")}</Text>
          {(packages.data ?? []).slice(0, 4).map((pkg) => (
            <View key={pkg.id} style={styles.txRow}>
              <View style={styles.txLeft}>
                <Text style={styles.txType}>{pkg.name}</Text>
                <Text style={styles.txDesc} numberOfLines={1}>
                  {pkg.tier ?? pkg.slug} · {pkg.price > 0 ? formatMoney(pkg.price, pkg.currency ?? baseCurrency.data ?? "", locale) : t("services.free_tier_short")}
                </Text>
              </View>
              <Text style={styles.txAmount}>{pkg.tokens_governance + pkg.tokens_impact + pkg.tokens_data}</Text>
            </View>
          ))}
        </>
      )}

      {(rewardRules.data ?? []).length > 0 && (
        <>
          <Text style={styles.svcSubTitle}>{t("services.reward_rules")}</Text>
          {(rewardRules.data ?? []).slice(0, 5).map((rule) => (
            <View key={rule.id} style={styles.txRow}>
              <View style={styles.txLeft}>
                <Text style={styles.txType}>{rule.action_name ?? rule.action_type}</Text>
                <Text style={styles.txDesc} numberOfLines={1}>
                  {rule.description ?? rule.token_type}
                </Text>
              </View>
              <View style={styles.ruleReward}>
                <Sparkles size={14} color={colors.warning} />
                <Text style={styles.ruleRewardText}>{rule.base_amount}</Text>
              </View>
            </View>
          ))}
        </>
      )}

      {/* Transaction history */}
      <Text style={styles.sectionTitle}>{t("wallet.history")}</Text>
      {transactions.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : transactions.data?.length === 0 ? (
        <Text style={styles.emptyText}>{t("wallet.noTransactions")}</Text>
      ) : (
        transactions.data?.map((tx) => (
          <View key={tx.id} style={styles.txRow}>
            <View style={styles.txLeft}>
              <Text style={styles.txType}>{tx.transaction_type}</Text>
              <Text style={styles.txDesc} numberOfLines={1}>
                {tx.description ?? tx.token_type}
              </Text>
            </View>
            <Text
              style={[
                styles.txAmount,
                { color: tx.amount >= 0 ? colors.success : colors.error },
              ]}
            >
              {tx.amount >= 0 ? "+" : ""}
              {tx.amount}
            </Text>
          </View>
        ))
      )}

      {/* Danger zone */}
      <TouchableOpacity
        style={styles.dangerBtn}
        onPress={() => {
          Alert.alert(
            t("wallet.delete.title"),
            t("wallet.delete.message"),
            [
              { text: t("common.cancel"), style: "cancel" },
              {
                text: t("wallet.delete.confirm"),
                style: "destructive",
                onPress: () => wallet.deleteWallet(),
              },
            ],
          );
        }}
      >
        <Trash2 size={16} color={colors.error} />
        <Text style={styles.dangerBtnText}>{t("wallet.delete.button")}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ── Styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background },

  hero: { alignItems: "center", marginTop: spacing.xl, marginBottom: spacing.lg },
  heroTitle: { color: colors.text, fontSize: 22, fontWeight: "700", marginTop: spacing.md },
  heroSubtitle: { color: colors.textSecondary, fontSize: 14, textAlign: "center", marginTop: spacing.sm },

  primaryBtn: {
    backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14,
    alignItems: "center", marginTop: spacing.md,
  },
  primaryBtnText: { color: colors.text, fontWeight: "600", fontSize: 16 },

  secondaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    marginTop: spacing.md, gap: spacing.sm,
  },
  secondaryBtnText: { color: colors.primary, fontWeight: "600" },

  importBox: { marginTop: spacing.md, backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md },
  mnemonicInput: {
    color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 8,
    padding: spacing.sm, minHeight: 80, textAlignVertical: "top", fontSize: 14,
  },

  backupBox: {
    marginTop: spacing.lg, backgroundColor: colors.surface, borderRadius: 12,
    padding: spacing.md, alignItems: "center",
  },
  backupTitle: { color: colors.warning, fontSize: 18, fontWeight: "700", marginTop: spacing.sm },
  backupWarning: { color: colors.textSecondary, fontSize: 13, textAlign: "center", marginTop: spacing.xs },
  mnemonicDisplay: {
    backgroundColor: colors.background, borderRadius: 8, padding: spacing.md,
    marginTop: spacing.md, width: "100%",
  },
  mnemonicText: { color: colors.text, fontSize: 14, lineHeight: 22 },

  addressCard: {
    backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md,
    alignItems: "center", marginBottom: spacing.md,
  },
  addressLabel: { color: colors.textSecondary, fontSize: 12, marginTop: spacing.xs },
  addressRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xs },
  addressText: { color: colors.text, fontSize: 13, maxWidth: 260 },

  balancesGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  balanceCard: {
    flex: 1, minWidth: "45%", backgroundColor: colors.surface, borderRadius: 12,
    padding: spacing.md, alignItems: "center",
  },
  balanceValue: { color: colors.text, fontSize: 22, fontWeight: "700" },
  balanceLabel: { color: colors.textSecondary, fontSize: 12, marginTop: spacing.xs },

  actionBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: colors.primaryDark, borderRadius: 12, paddingVertical: 14,
    gap: spacing.sm, marginBottom: spacing.lg,
  },
  actionBtnText: { color: colors.text, fontWeight: "600", fontSize: 16 },

  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: spacing.sm },

  emptyText: { color: colors.textMuted, textAlign: "center", marginVertical: spacing.md },

  txRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: colors.surface, borderRadius: 10, padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  txLeft: { flex: 1 },
  txType: { color: colors.textSecondary, fontSize: 11, textTransform: "uppercase" },
  txDesc: { color: colors.text, fontSize: 14, marginTop: 2 },
  txAmount: { fontSize: 16, fontWeight: "700", marginLeft: spacing.sm },

  dangerBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    marginTop: spacing.xl, gap: spacing.xs,
  },
  dangerBtnText: { color: colors.error, fontSize: 13 },

  svcCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, marginBottom: spacing.md,
  },
  svcBody: { flex: 1 },
  svcName: { color: colors.text, fontSize: 15, fontWeight: "600" },
  svcMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  svcBadge: { backgroundColor: `${colors.success}22`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  svcBadgeText: { color: colors.success, fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  svcSubTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: "600", marginBottom: spacing.xs },
  quotaBg: { height: 5, borderRadius: 3, backgroundColor: colors.border, marginTop: spacing.xs, overflow: "hidden" },
  quotaFill: { height: 5, borderRadius: 3, backgroundColor: colors.warning },
  ruleReward: { flexDirection: "row", alignItems: "center", gap: 3 },
  ruleRewardText: { color: colors.warning, fontSize: 13, fontWeight: "700" },
});
