import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Vote, CheckCircle, XCircle, MinusCircle, Ban } from "lucide-react";
import { useSession } from "@/hooks/useSession";
import {
  useGovernanceProposals,
  useGovernanceVote,
} from "@/hooks/useGovernanceProposals";

import type { VoteOption } from "@/hooks/useGovernanceProposals";

const VOTE_OPTIONS: {
  key: VoteOption;
  icon: typeof CheckCircle;
  color: string;
  labelKey: string;
}[] = [
  { key: "VOTE_OPTION_YES", icon: CheckCircle, color: "text-green-500", labelKey: "governance.voteYes" },
  { key: "VOTE_OPTION_NO", icon: XCircle, color: "text-red-500", labelKey: "governance.voteNo" },
  { key: "VOTE_OPTION_ABSTAIN", icon: MinusCircle, color: "text-gray-400", labelKey: "governance.voteAbstain" },
  { key: "VOTE_OPTION_NO_WITH_VETO", icon: Ban, color: "text-amber-500", labelKey: "governance.voteVeto" },
];

export default function MemberGovernance() {
  const { t } = useTranslation();
  const { user } = useSession();
  const proposals = useGovernanceProposals();
  const voteMutation = useGovernanceVote();

  const handleVote = (proposalId: string, option: VoteOption) => {
    voteMutation.mutate({ proposalId, option });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center gap-3 mb-6">
          <Vote className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">{t("governance.title")}</h1>
            <p className="text-muted-foreground">{t("governance.subtitle")}</p>
          </div>
        </div>

        {proposals.isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : proposals.data?.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {t("governance.noProposals")}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {proposals.data?.map((proposal) => (
              <Card key={proposal.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs">
                      #{proposal.id}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {t("governance.votingEnds")}:{" "}
                      {new Date(proposal.voting_end_time).toLocaleDateString()}
                    </span>
                  </div>
                  <CardTitle className="text-lg">{proposal.title}</CardTitle>
                  <CardDescription className="line-clamp-3">
                    {proposal.summary}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {VOTE_OPTIONS.map(({ key, icon: Icon, color, labelKey }) => (
                      <Button
                        key={key}
                        variant="outline"
                        size="sm"
                        disabled={voteMutation.isPending}
                        onClick={() => handleVote(proposal.id, key)}
                        className="gap-1.5"
                      >
                        <Icon className={`h-4 w-4 ${color}`} />
                        {t(labelKey)}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
