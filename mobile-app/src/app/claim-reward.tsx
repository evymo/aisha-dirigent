/**
 * Claim Reward Screen — collect AISHA token rewards on-chain.
 *
 * Flow:
 * 1. Lists the user's PENDING reward claims via get_my_reward_claims (through the
 *    AISHA gateway, keyed by auth.uid()) — useRewardClaims refreshes every 30s.
 * 2. User taps "Claim" → the claim-cosmos-reward gateway function triggers the
 *    backend signer (svc-blockchain) to mint/transfer to the user's address.
 * 3. On success the claim flips to fulfilled and drops out of the pending list.
 */
import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Stack } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth, useTranslation } from "@/hooks";
import { useCosmosWallet } from "@/hooks/useCosmosWallet";
import { useRewardClaims } from "@/hooks/useRewardClaims";
import { api } from "@/config/api";
import { colors, spacing } from "@/theme";
import { Gift, CheckCircle } from "lucide-react-native";
import type { RewardClaim } from "@/types/schemas";

export default function ClaimRewardScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const wallet = useCosmosWallet();
  const queryClient = useQueryClient();
  const { data: rewardClaims, isLoading } = useRewardClaims(user?.id);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<Set<string>>(new Set());

  // Only PENDING claims are actionable; fulfilled/failed drop out of the list.
  const pendingRewards = (rewardClaims ?? []).filter((r) => r.status === "pending");

  const handleClaim = async (reward: RewardClaim) => {
    if (!wallet.address) {
      Alert.alert(t("wallet.required"));
      return;
    }

    setClaiming(reward.id);
    try {
      // The claim-cosmos-reward gateway function triggers backend-signed distribution.
      const { error } = await api.invoke("claim-cosmos-reward", {
        body: {
          claim_id: reward.id,
          recipient_address: wallet.address,
        },
      });

      if (error) throw new Error(error.message);

      setClaimed((prev) => new Set(prev).add(reward.id));
      // Refetch so the now-fulfilled claim drops out of the pending list.
      queryClient.invalidateQueries({ queryKey: ["reward-claims", user?.id] });
      Alert.alert(
        t("claimReward.success"),
        `${reward.amount} ${reward.denom} → ${wallet.address.slice(0, 12)}…`,
      );
    } catch (e: unknown) {
      Alert.alert(t("claimReward.failed"), e instanceof Error ? e.message : "Claim failed");
    } finally {
      setClaiming(null);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: t("claimReward.title") }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Gift size={40} color={colors.primary} />
          <Text style={styles.title}>{t("claimReward.title")}</Text>
          <Text style={styles.subtitle}>{t("claimReward.subtitle")}</Text>
        </View>

        {!wallet.isInitialized && (
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>{t("claimReward.walletRequired")}</Text>
          </View>
        )}

        {isLoading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : pendingRewards.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>{t("claimReward.noRewards")}</Text>
          </View>
        ) : (
          pendingRewards.map((reward) => (
            <View key={reward.id} style={styles.rewardCard}>
              <View style={styles.rewardInfo}>
                <Text style={styles.rewardAmount}>+{reward.amount}</Text>
                <Text style={styles.rewardType}>{reward.denom}</Text>
              </View>
              {claimed.has(reward.id) ? (
                <CheckCircle size={24} color={colors.success} />
              ) : (
                <TouchableOpacity
                  style={styles.claimBtn}
                  disabled={claiming === reward.id || !wallet.isInitialized}
                  onPress={() => handleClaim(reward)}
                >
                  {claiming === reward.id ? (
                    <ActivityIndicator size="small" color={colors.text} />
                  ) : (
                    <Text style={styles.claimBtnText}>{t("claimReward.claim")}</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },

  header: { alignItems: "center", marginTop: spacing.xl, marginBottom: spacing.lg },
  title: { color: colors.text, fontSize: 22, fontWeight: "700", marginTop: spacing.md },
  subtitle: { color: colors.textSecondary, fontSize: 14, textAlign: "center", marginTop: spacing.xs },

  warningBox: {
    backgroundColor: colors.warning + "20", borderRadius: 12, padding: spacing.md,
    marginBottom: spacing.md,
  },
  warningText: { color: colors.warning, textAlign: "center", fontSize: 14 },

  emptyState: { alignItems: "center", marginTop: 40 },
  emptyText: { color: colors.textMuted, fontSize: 15 },

  rewardCard: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rewardInfo: { flex: 1 },
  rewardAmount: { color: colors.success, fontSize: 20, fontWeight: "700" },
  rewardType: { color: colors.textSecondary, fontSize: 12, textTransform: "uppercase" },

  claimBtn: {
    backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10,
    paddingHorizontal: 20, marginLeft: spacing.sm,
  },
  claimBtnText: { color: colors.text, fontWeight: "600" },
});
