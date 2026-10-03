import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Vote, CheckCircle, XCircle, Clock, Database, RefreshCw, AlertTriangle } from "lucide-react";
import { useGovernanceProposals } from "@/hooks/useGovernanceProposals";
import { useCosmosLedgerStatus } from "@/hooks/useCosmosLedgerStatus";
import { useRetryBlockchainSync } from "@/hooks/useRetryBlockchainSync";
import { useToast } from "@/hooks/use-toast";

import type { Proposal } from "@/hooks/useGovernanceProposals";

const STATUS_COLORS: Record<string, string> = {
  PROPOSAL_STATUS_VOTING_PERIOD: "bg-green-100 text-green-700",
  PROPOSAL_STATUS_DEPOSIT_PERIOD: "bg-yellow-100 text-yellow-700",
  PROPOSAL_STATUS_PASSED: "bg-blue-100 text-blue-700",
  PROPOSAL_STATUS_REJECTED: "bg-red-100 text-red-700",
  PROPOSAL_STATUS_FAILED: "bg-gray-100 text-gray-700",
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  PROPOSAL_STATUS_VOTING_PERIOD: "admin.governance.statusVoting",
  PROPOSAL_STATUS_DEPOSIT_PERIOD: "admin.governance.statusDeposit",
  PROPOSAL_STATUS_PASSED: "admin.governance.statusPassed",
  PROPOSAL_STATUS_REJECTED: "admin.governance.statusRejected",
  PROPOSAL_STATUS_FAILED: "admin.governance.statusFailed",
};

export function GovernancePanel() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("PROPOSAL_STATUS_VOTING_PERIOD");
  const proposals = useGovernanceProposals(statusFilter);
  const ledgerStatus = useCosmosLedgerStatus();
  const { isAdmin, resetStale } = useRetryBlockchainSync();
  const [createOpen, setCreateOpen] = useState(false);
  const [retryTimeout, setRetryTimeout] = useState("5");

  // New proposal form state
  const [newProposal, setNewProposal] = useState({
    title: "",
    description: "",
    deposit: "10000000",
  });

  const handleCreateProposal = () => {
    // TODO: Implement proposal creation via Cosmos node CLI or REST
    // This requires a governance proposal submission via backend signer
    // For now, the admin creates proposals directly via the cosmos node CLI
    setCreateOpen(false);
    setNewProposal({ title: "", description: "", deposit: "10000000" });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Vote className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">
            {t("admin.governance.title")}
          </h2>
        </div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PROPOSAL_STATUS_VOTING_PERIOD">{t("admin.governance.statusVoting")}</SelectItem>
              <SelectItem value="PROPOSAL_STATUS_DEPOSIT_PERIOD">{t("admin.governance.statusDeposit")}</SelectItem>
              <SelectItem value="PROPOSAL_STATUS_PASSED">{t("admin.governance.statusPassed")}</SelectItem>
              <SelectItem value="PROPOSAL_STATUS_REJECTED">{t("admin.governance.statusRejected")}</SelectItem>
            </SelectContent>
          </Select>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                {t("admin.governance.createProposal")}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {t("admin.governance.createProposalDialog")}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>{t("admin.governance.proposalTitle")}</Label>
                  <Input
                    value={newProposal.title}
                    onChange={(e) =>
                      setNewProposal({ ...newProposal, title: e.target.value })
                    }
                    placeholder={t("admin.governance.placeholder.title")}
                  />
                </div>
                <div>
                  <Label>{t("admin.governance.proposalDescription")}</Label>
                  <Textarea
                    value={newProposal.description}
                    onChange={(e) =>
                      setNewProposal({ ...newProposal, description: e.target.value })
                    }
                    placeholder={t("admin.governance.placeholder.description")}
                    rows={4}
                  />
                </div>
                <div>
                  <Label>{t("admin.governance.deposit")}</Label>
                  <Input
                    type="number"
                    value={newProposal.deposit}
                    onChange={(e) =>
                      setNewProposal({ ...newProposal, deposit: e.target.value })
                    }
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("admin.governance.depositMinimum")}
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={handleCreateProposal}
                  disabled={!newProposal.title || !newProposal.description}
                >
                  {t("admin.governance.submit")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Chain Info Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t("admin.governance.chainInfo")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">{t("admin.governance.chainId")}</p>
              <p className="font-mono">{"aisha-1"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("admin.governance.denom")}</p>
              <p className="font-mono">{"uash (ASH)"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("admin.governance.governance")}</p>
              <p className="font-mono">{"ugovernance"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("admin.governance.server")}</p>
              <p className="font-mono">{"Experimental"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ledger Status Card */}
      {ledgerStatus.data && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="w-4 h-4" />
              {t("admin.governance.ledgerStatus")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">{t("admin.governance.totalRecords")}</p>
                <p className="text-2xl font-bold">{ledgerStatus.data.total}</p>
              </div>
              <div>
                <p className="text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {t("admin.governance.pendingRecords")}
                </p>
                <p className="text-2xl font-bold text-yellow-600">{ledgerStatus.data.pending}</p>
              </div>
              <div>
                <p className="text-muted-foreground flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  {t("admin.governance.confirmedRecords")}
                </p>
                <p className="text-2xl font-bold text-green-600">{ledgerStatus.data.confirmed}</p>
              </div>
              <div>
                <p className="text-muted-foreground flex items-center gap-1">
                  <XCircle className="w-3 h-3" />
                  {t("admin.governance.failedRecords")}
                </p>
                <p className="text-2xl font-bold text-destructive">{ledgerStatus.data.failed}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("admin.governance.lastSync")}</p>
                <p className="font-mono text-sm">
                  {ledgerStatus.data.last_sync
                    ? new Date(ledgerStatus.data.last_sync).toLocaleString()
                    : t("admin.governance.noSyncYet")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Queue Health — Admin Retry Card */}
      {isAdmin && ledgerStatus.data && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {t("admin.governance.queueHealth")}
            </CardTitle>
            <CardDescription>
              {t("admin.governance.queueHealthDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-4">
              <div className="space-y-1">
                <Label className="text-xs">{t("admin.governance.timeoutMinutes")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={retryTimeout}
                  onChange={(e) => setRetryTimeout(e.target.value)}
                  className="w-24"
                />
              </div>
              <Button
                variant="outline"
                disabled={resetStale.isPending}
                onClick={() => {
                  const minutes = parseInt(retryTimeout, 10);
                  resetStale.mutate(
                    { timeoutMinutes: Number.isFinite(minutes) ? minutes : 5 },
                    {
                      onSuccess: (count) => {
                        toast({
                          title: count > 0
                            ? t("admin.governance.retrySuccess", { count })
                            : t("admin.governance.retryNone"),
                        });
                      },
                    }
                  );
                }}
              >
                {resetStale.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                {t("admin.governance.retryButton")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Proposals List */}
      {proposals.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : proposals.data?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {t("admin.governance.noProposals")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {proposals.data?.map((proposal: Proposal) => (
            <Card key={proposal.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs font-mono">
                      #{proposal.id}
                    </Badge>
                    <Badge
                      className={`text-xs ${STATUS_COLORS[proposal.status] ?? "bg-gray-100 text-gray-700"}`}
                    >
                      {STATUS_LABEL_KEYS[proposal.status] ? t(STATUS_LABEL_KEYS[proposal.status]) : proposal.status}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {t("admin.governance.votingEnds")}:{" "}
                    {new Date(proposal.voting_end_time).toLocaleDateString()}
                  </span>
                </div>
                <CardTitle className="text-base">{proposal.title}</CardTitle>
                {proposal.summary && (
                  <CardDescription className="line-clamp-2">
                    {proposal.summary}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>
                    {t("admin.governance.depositLabel")}{`: ${proposal.total_deposit} uash`}
                  </span>
                  <span>
                    {t("admin.governance.start")}: {new Date(proposal.voting_start_time).toLocaleDateString()}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
