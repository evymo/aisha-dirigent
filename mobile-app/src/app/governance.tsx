/**
 * Governance Screen — Browse and vote on AISHA chain governance proposals.
 *
 * Flow: Fetch proposals via cosmos-gov-read EF → display → user votes
 *       → governance-vote EF (backend-signed via Supabase JWT).
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
  RefreshControl,
} from "react-native";
import { Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@/hooks";
import { useCosmosWallet } from "@/hooks/useCosmosWallet";
import { api, getBackendUrl, getAnonKey } from "@/config/api";
import { colors, spacing } from "@/theme";
import { Vote, CheckCircle, XCircle, MinusCircle, Ban } from "lucide-react-native";

// ── Types ────────────────────────────────────────────────────
interface Proposal {
  id: string;
  title: string;
  description: string;
  status: string;
  votingEndTime: string;
}

type VoteOption = "yes" | "no" | "abstain" | "no_with_veto";

const VOTE_OPTIONS: { key: VoteOption; icon: typeof CheckCircle; color: string; label: string }[] = [
  { key: "yes", icon: CheckCircle, color: colors.success, label: "Yes" },
  { key: "no", icon: XCircle, color: colors.error, label: "No" },
  { key: "abstain", icon: MinusCircle, color: colors.textMuted, label: "Abstain" },
  { key: "no_with_veto", icon: Ban, color: colors.warning, label: "No with Veto" },
];

// Vote option → Cosmos SDK enum string
const VOTE_OPTION_MAP: Record<VoteOption, string> = {
  yes: "VOTE_OPTION_YES",
  abstain: "VOTE_OPTION_ABSTAIN",
  no: "VOTE_OPTION_NO",
  no_with_veto: "VOTE_OPTION_NO_WITH_VETO",
};

// ── Component ────────────────────────────────────────────────
export default function GovernanceScreen() {
  const { t } = useTranslation();
  const wallet = useCosmosWallet();
  const queryClient = useQueryClient();
  const [votingProposal, setVotingProposal] = useState<string | null>(null);

  // Fetch active proposals via cosmos-gov-read EF proxy
  const proposals = useQuery<Proposal[]>({
    queryKey: ["governance-proposals"],
    queryFn: async () => {
      try {
        const [baseUrl, anonKey] = await Promise.all([getBackendUrl(), getAnonKey()]);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        const res = await fetch(
          `${baseUrl}/functions/v1/cosmos-gov-read/cosmos/gov/v1/proposals?proposal_status=PROPOSAL_STATUS_VOTING_PERIOD`,
          {
            headers: { apikey: anonKey },
            signal: controller.signal,
          },
        );
        clearTimeout(timer);
        if (!res.ok) return [];
        const json = await res.json();
        return (json.proposals ?? []).map((p: Record<string, unknown>) => ({
          id: p.id,
          title: p.title ?? `Proposal #${p.id}`,
          description: p.summary ?? "",
          status: p.status,
          votingEndTime: p.voting_end_time,
        }));
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });

  // Vote via governance-vote EF (backend-signed)
  const voteMutation = useMutation({
    mutationFn: async ({ proposalId, option }: { proposalId: string; option: VoteOption }) => {
      const { data, error } = await api.invoke(
        "governance-vote",
        {
          body: {
            proposal_id: proposalId,
            vote_option: VOTE_OPTION_MAP[option],
          },
        },
      );
      if (error) throw new Error(error.message);
      return data as { tx_hash: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["governance-proposals"] });
      Alert.alert(t("governance.voteSuccess"), `Tx: ${data.tx_hash.slice(0, 16)}…`);
    },
    onError: (err: Error) => {
      Alert.alert(t("governance.voteFailed"), err.message);
    },
    onSettled: () => {
      setVotingProposal(null);
    },
  });

  const handleVote = (proposalId: string, option: VoteOption) => {
    if (!wallet.isInitialized) {
      Alert.alert(t("wallet.required"));
      return;
    }
    setVotingProposal(proposalId);
    voteMutation.mutate({ proposalId, option });
  };

  return (
    <>
      <Stack.Screen options={{ title: t("governance.title") }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={proposals.isRefetching}
            onRefresh={() => proposals.refetch()}
            tintColor={colors.primary}
          />
        }
      >
        <View style={styles.header}>
          <Vote size={28} color={colors.primary} />
          <Text style={styles.title}>{t("governance.title")}</Text>
          <Text style={styles.subtitle}>{t("governance.subtitle")}</Text>
        </View>

        {!wallet.isInitialized && (
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>{t("governance.walletRequired")}</Text>
          </View>
        )}

        {proposals.isLoading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : proposals.data?.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>{t("governance.noProposals")}</Text>
          </View>
        ) : (
          proposals.data?.map((proposal) => (
            <View key={proposal.id} style={styles.proposalCard}>
              <Text style={styles.proposalId}>#{proposal.id}</Text>
              <Text style={styles.proposalTitle}>{proposal.title}</Text>
              <Text style={styles.proposalDesc} numberOfLines={3}>
                {proposal.description}
              </Text>
              <Text style={styles.proposalDeadline}>
                {t("governance.votingEnds")}: {new Date(proposal.votingEndTime).toLocaleDateString()}
              </Text>

              {/* Vote buttons */}
              <View style={styles.voteRow}>
                {VOTE_OPTIONS.map(({ key, icon: Icon, color, label }) => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.voteBtn, { borderColor: color }]}
                    disabled={votingProposal === proposal.id || !wallet.isInitialized}
                    onPress={() => handleVote(proposal.id, key)}
                  >
                    {votingProposal === proposal.id ? (
                      <ActivityIndicator size="small" color={color} />
                    ) : (
                      <>
                        <Icon size={16} color={color} />
                        <Text style={[styles.voteBtnText, { color }]}>{label}</Text>
                      </>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </>
  );
}

// ── Styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },

  header: { alignItems: "center", marginBottom: spacing.lg },
  title: { color: colors.text, fontSize: 22, fontWeight: "700", marginTop: spacing.sm },
  subtitle: { color: colors.textSecondary, fontSize: 14, textAlign: "center", marginTop: spacing.xs },

  warningBox: {
    backgroundColor: colors.warning + "20", borderRadius: 12, padding: spacing.md,
    marginBottom: spacing.md,
  },
  warningText: { color: colors.warning, textAlign: "center", fontSize: 14 },

  emptyState: { alignItems: "center", marginTop: 40 },
  emptyText: { color: colors.textMuted, fontSize: 15 },

  proposalCard: {
    backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md,
    marginBottom: spacing.md,
  },
  proposalId: { color: colors.textMuted, fontSize: 11, fontWeight: "600" },
  proposalTitle: { color: colors.text, fontSize: 16, fontWeight: "700", marginTop: spacing.xs },
  proposalDesc: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.xs },
  proposalDeadline: { color: colors.textMuted, fontSize: 11, marginTop: spacing.sm },

  voteRow: {
    flexDirection: "row", justifyContent: "space-between", marginTop: spacing.md,
    gap: spacing.xs,
  },
  voteBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderRadius: 8, paddingVertical: 10, gap: 4,
  },
  voteBtnText: { fontSize: 11, fontWeight: "600" },
});
