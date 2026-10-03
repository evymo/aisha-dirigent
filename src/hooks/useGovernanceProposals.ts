/**
 * Governance Proposals Hook — fetches proposals from AISHA Cosmos chain.
 *
 * Queries the x/gov REST endpoint for active proposals,
 * provides voting mutation via Supabase Edge Function (backend signer).
 *
 * Web version: No direct signing — delegates vote execution to backend
 * via Edge Function that validates the user's Supabase JWT and submits
 * MsgVote on their behalf (backend-signed, not user-signed).
 * Mobile version uses direct user signing via useCosmosWallet.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { z } from "zod";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import type { DeliverTxResponse } from "@cosmjs/stargate";

// ── Schemas ──────────────────────────────────────────────────
const proposalSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().default(""),
  status: z.string(),
  voting_start_time: z.string(),
  voting_end_time: z.string(),
  total_deposit: z.string().default("0"),
});

export type Proposal = z.infer<typeof proposalSchema>;

export type VoteOption = "VOTE_OPTION_YES" | "VOTE_OPTION_NO" | "VOTE_OPTION_ABSTAIN" | "VOTE_OPTION_NO_WITH_VETO";

const GATEWAY_URL = import.meta.env.VITE_AISHA_GATEWAY_URL ?? "";
const GATEWAY_KEY = import.meta.env.VITE_AISHA_GATEWAY_KEY ?? "";
const COSMOS_PROXY = `${GATEWAY_URL}/functions/v1/cosmos-gov-read`;

// ── Fetch proposals ──────────────────────────────────────────
export function useGovernanceProposals(status?: string) {
  const statusFilter = status ?? "PROPOSAL_STATUS_VOTING_PERIOD";

  return useQuery<Proposal[]>({
    queryKey: ["governance-proposals", statusFilter],
    queryFn: async () => {
      const res = await fetch(
        `${COSMOS_PROXY}/cosmos/gov/v1/proposals?proposal_status=${statusFilter}`,
        {
          signal: AbortSignal.timeout(15_000),
          headers: { apikey: GATEWAY_KEY },
        },
      );
      if (!res.ok) return [];
      const json = await res.json();
      return (json.proposals ?? []).map((p: unknown) => {
        const parsed = proposalSchema.safeParse(p);
        return parsed.success ? parsed.data : null;
      }).filter(Boolean) as Proposal[];
    },
    staleTime: 60_000,
  });
}

// ── Vote mutation (web — backend-signed) ─────────────────────
export function useGovernanceVote() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async ({
      proposalId,
      option,
    }: {
      proposalId: string;
      option: VoteOption;
    }) => {
      const { data, error } = await aisha.functions.invoke(
        "governance-vote",
        {
          body: { proposal_id: proposalId, vote_option: option },
        },
      );
      if (error) throw new Error(error.message);
      return data as { tx_hash: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["governance-proposals"] });
      toast.success(t("governance.voteSuccess"), {
        description: `Tx: ${data.tx_hash.slice(0, 16)}…`,
      });
    },
    onError: (err: Error) => {
      toast.error(t("governance.voteFailed"), {
        description: err.message,
      });
    },
  });
}
