import { useState, useMemo } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Building2,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Link as LinkIcon,
  AlertTriangle,
  Ban,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  useUnmatchedBankTransactions,
  useAllBankTransactions,
  useAwaitingTransferOrders,
  useMatchTransactionToOrder,
  useDismissTransaction,
  useFioBankSync,
  useFioBankSyncStatus,
  type BankTransaction,
  type AwaitingOrder,
} from "@/hooks";
import { useCurrency } from "@/hooks/useCurrency";

/**
 * Admin Bank Reconciliation page.
 *
 * Provides:
 * - View unmatched bank transactions from Fio API
 * - Manually match transactions to awaiting orders
 * - Dismiss irrelevant transactions
 * - Trigger manual Fio bank sync
 * - View all transactions history
 */
export default function AdminBankReconciliation() {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);
  const { formatCurrency } = useCurrency();

  // Data hooks
  const {
    data: unmatchedTransactions = [],
    isLoading: loadingUnmatched,
    refetch: refetchUnmatched,
  } = useUnmatchedBankTransactions();
  const {
    data: allTransactions = [],
    isLoading: loadingAll,
    refetch: refetchAll,
  } = useAllBankTransactions();
  const {
    data: awaitingOrders = [],
    isLoading: loadingOrders,
  } = useAwaitingTransferOrders();
  const { data: syncStatus } = useFioBankSyncStatus();

  // Mutations
  const matchMutation = useMatchTransactionToOrder();
  const dismissMutation = useDismissTransaction();
  const syncMutation = useFioBankSync();

  // UI state
  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const [dismissDialogOpen, setDismissDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] =
    useState<BankTransaction | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [matchNotes, setMatchNotes] = useState("");
  const [dismissNotes, setDismissNotes] = useState("");
  const [searchFilter, setSearchFilter] = useState("");

  // Filter
  const filteredUnmatched = useMemo(() => {
    if (!searchFilter.trim()) return unmatchedTransactions;
    const q = searchFilter.toLowerCase();
    return unmatchedTransactions.filter(
      (tx) =>
        (tx.variable_symbol?.toLowerCase() ?? "").includes(q) ||
        (tx.sender_name?.toLowerCase() ?? "").includes(q) ||
        (tx.sender_account?.toLowerCase() ?? "").includes(q) ||
        String(tx.amount).includes(q),
    );
  }, [unmatchedTransactions, searchFilter]);

  const filteredAll = useMemo(() => {
    if (!searchFilter.trim()) return allTransactions;
    const q = searchFilter.toLowerCase();
    return allTransactions.filter(
      (tx) =>
        (tx.variable_symbol?.toLowerCase() ?? "").includes(q) ||
        (tx.sender_name?.toLowerCase() ?? "").includes(q) ||
        (tx.match_status?.toLowerCase() ?? "").includes(q) ||
        String(tx.amount).includes(q),
    );
  }, [allTransactions, searchFilter]);

  // ─── Handlers ──────────────────────────────────────────────

  const handleSync = async () => {
    try {
      const result = await syncMutation.mutateAsync({});
      toast.success(
        t("admin.bankReconciliation.syncSuccess", {
          total: result.total ?? 0,
          inserted: result.inserted ?? 0,
          autoMatched: result.auto_matched ?? 0,
        }),
      );
      refetchUnmatched();
      refetchAll();
    } catch {
      toast.error(t("admin.bankReconciliation.syncError"));
    }
  };

  const openMatchDialog = (tx: BankTransaction) => {
    setSelectedTransaction(tx);
    setSelectedOrderId("");
    setMatchNotes("");
    setMatchDialogOpen(true);
  };

  const openDismissDialog = (tx: BankTransaction) => {
    setSelectedTransaction(tx);
    setDismissNotes("");
    setDismissDialogOpen(true);
  };

  const handleMatch = async () => {
    if (!selectedTransaction || !selectedOrderId) return;

    try {
      await matchMutation.mutateAsync({
        order_id: selectedOrderId,
        transaction_id: selectedTransaction.id,
        notes: matchNotes || undefined,
      });
      toast.success(t("admin.bankReconciliation.matchSuccess"));
      setMatchDialogOpen(false);
    } catch {
      toast.error(t("admin.bankReconciliation.matchError"));
    }
  };

  const handleDismiss = async () => {
    if (!selectedTransaction) return;

    try {
      await dismissMutation.mutateAsync({
        transaction_id: selectedTransaction.id,
        notes: dismissNotes || undefined,
      });
      toast.success(t("admin.bankReconciliation.dismissSuccess"));
      setDismissDialogOpen(false);
    } catch {
      toast.error(t("admin.bankReconciliation.dismissError"));
    }
  };

  // ─── Helpers ───────────────────────────────────────────────

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "matched":
        return (
          <Badge variant="default" className="bg-green-600">
            <CheckCircle className="h-3 w-3 mr-1" />
            {t("admin.bankReconciliation.statusMatched")}
          </Badge>
        );
      case "unmatched":
        return (
          <Badge variant="outline" className="border-amber-500 text-amber-600">
            <Clock className="h-3 w-3 mr-1" />
            {t("admin.bankReconciliation.statusUnmatched")}
          </Badge>
        );
      case "amount_mismatch":
        return (
          <Badge variant="destructive">
            <AlertTriangle className="h-3 w-3 mr-1" />
            {t("admin.bankReconciliation.statusAmountMismatch")}
          </Badge>
        );
      case "dismissed":
        return (
          <Badge variant="secondary">
            <Ban className="h-3 w-3 mr-1" />
            {t("admin.bankReconciliation.statusDismissed")}
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "—";
    try {
      return format(new Date(dateStr), "dd. MM. yyyy", { locale: dateLocale });
    } catch {
      return dateStr;
    }
  };

  // Find matching VS suggestion for a transaction
  const findSuggestedOrder = (tx: BankTransaction): AwaitingOrder | undefined => {
    if (!tx.variable_symbol) return undefined;
    return awaitingOrders.find((o) => o.variable_symbol === tx.variable_symbol);
  };

  // ─── Transaction Row ──────────────────────────────────────

  const TransactionRow = ({
    tx,
    showActions,
  }: {
    tx: BankTransaction;
    showActions: boolean;
  }) => {
    const suggestedOrder = showActions ? findSuggestedOrder(tx) : undefined;

    return (
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 p-4 border rounded-lg hover:bg-muted/30 transition-colors">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            {getStatusBadge(tx.match_status)}
            {tx.match_type && (
              <Badge variant="outline" className="text-xs">
                {tx.match_type}
              </Badge>
            )}
            <span className="text-sm text-muted-foreground">
              {formatDate(tx.transaction_date)}
            </span>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <span className="font-mono text-lg font-bold">
              {formatCurrency(tx.amount, tx.currency)}
            </span>
            {tx.variable_symbol && (
              <span className="font-mono text-sm bg-muted px-2 py-0.5 rounded">
                {t("admin.bankReconciliation.vsLabel")} {tx.variable_symbol}
              </span>
            )}
          </div>
          <div className="text-sm text-muted-foreground truncate">
            {tx.sender_name || tx.sender_account || t("admin.bankReconciliation.unknownSender")}
            {tx.message && <span className="ml-2 italic">— {tx.message}</span>}
          </div>
          {tx.match_notes && (
            <div className="text-xs text-muted-foreground italic">
              {tx.match_notes}
            </div>
          )}
          {suggestedOrder && (
            <div className="text-xs text-green-600 font-medium flex items-center gap-1">
              <CheckCircle className="h-3 w-3" />
              {t("admin.bankReconciliation.suggestedMatch", {
                vs: suggestedOrder.variable_symbol ?? "",
                amount: formatCurrency(
                  suggestedOrder.bank_transfer_amount ?? suggestedOrder.total,
                  suggestedOrder.currency,
                ),
              })}
            </div>
          )}
        </div>

        {showActions && (
          <div className="flex gap-2 flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => openMatchDialog(tx)}
            >
              <LinkIcon className="h-3.5 w-3.5 mr-1.5" />
              {t("admin.bankReconciliation.match")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => openDismissDialog(tx)}
            >
              <XCircle className="h-3.5 w-3.5 mr-1.5" />
              {t("admin.bankReconciliation.dismiss")}
            </Button>
          </div>
        )}
      </div>
    );
  };

  // ─── Render ────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {t("admin.bankReconciliation.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("admin.bankReconciliation.description")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleSync}
            disabled={syncMutation.isPending}
            variant="outline"
          >
            {syncMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {t("admin.bankReconciliation.syncFio")}
          </Button>
        </div>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Building2 className="h-8 w-8 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("admin.bankReconciliation.fioStatus")}
                </p>
                <p className="text-lg font-bold">
                  {syncStatus?.configured
                    ? syncStatus.enabled
                      ? t("admin.bankReconciliation.fioEnabled")
                      : t("admin.bankReconciliation.fioDisabled")
                    : t("admin.bankReconciliation.fioNotConfigured")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Clock className="h-8 w-8 text-amber-500" />
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("admin.bankReconciliation.unmatchedCount")}
                </p>
                <p className="text-lg font-bold">{unmatchedTransactions.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-red-500" />
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("admin.bankReconciliation.awaitingOrders")}
                </p>
                <p className="text-lg font-bold">{awaitingOrders.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("admin.bankReconciliation.totalTransactions")}
                </p>
                <p className="text-lg font-bold">{allTransactions.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("admin.bankReconciliation.searchPlaceholder")}
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Tabs: Unmatched / All */}
      <Tabs defaultValue="unmatched">
        <TabsList>
          <TabsTrigger value="unmatched">
            {t("admin.bankReconciliation.tabUnmatched")} ({filteredUnmatched.length})
          </TabsTrigger>
          <TabsTrigger value="all">
            {t("admin.bankReconciliation.tabAll")} ({filteredAll.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="unmatched" className="space-y-3 mt-4">
          {loadingUnmatched ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredUnmatched.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
                <p className="text-lg font-medium">
                  {t("admin.bankReconciliation.allMatched")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("admin.bankReconciliation.allMatchedDesc")}
                </p>
              </CardContent>
            </Card>
          ) : (
            filteredUnmatched.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} showActions />
            ))
          )}
        </TabsContent>

        <TabsContent value="all" className="space-y-3 mt-4">
          {loadingAll ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredAll.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  {t("admin.bankReconciliation.noTransactions")}
                </p>
              </CardContent>
            </Card>
          ) : (
            filteredAll.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} showActions={false} />
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* ─── Match Dialog ─── */}
      <Dialog open={matchDialogOpen} onOpenChange={setMatchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("admin.bankReconciliation.matchDialogTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.bankReconciliation.matchDialogDesc")}
            </DialogDescription>
          </DialogHeader>

          {selectedTransaction && (
            <div className="space-y-4">
              <div className="bg-muted p-3 rounded-lg space-y-1">
                <p className="text-sm font-medium">
                  {t("admin.bankReconciliation.transaction")}:
                </p>
                <p className="font-mono">
                  {formatCurrency(
                    selectedTransaction.amount,
                    selectedTransaction.currency,
                  )}{" "}
                  | {t("admin.bankReconciliation.vsLabel")} {selectedTransaction.variable_symbol || "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {selectedTransaction.sender_name || selectedTransaction.sender_account}
                </p>
              </div>

              <div>
                <Label>{t("admin.bankReconciliation.selectOrder")}</Label>
                <Select value={selectedOrderId} onValueChange={setSelectedOrderId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue
                      placeholder={t("admin.bankReconciliation.selectOrderPlaceholder")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {loadingOrders ? (
                      <div className="p-4 text-center">
                        <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                      </div>
                    ) : (
                      awaitingOrders.map((order) => (
                        <SelectItem key={order.id} value={order.id}>
                          <span className="font-mono text-xs">
                            #{order.id.slice(0, 8)}
                          </span>{" "}
                          | {t("admin.bankReconciliation.vsLabel")} {order.variable_symbol || "—"} |{" "}
                          {formatCurrency(
                            order.bank_transfer_amount ?? order.total,
                            order.currency,
                          )}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>{t("admin.bankReconciliation.notes")}</Label>
                <Input
                  className="mt-1"
                  value={matchNotes}
                  onChange={(e) => setMatchNotes(e.target.value)}
                  placeholder={t("admin.bankReconciliation.notesPlaceholder")}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setMatchDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleMatch}
              disabled={!selectedOrderId || matchMutation.isPending}
            >
              {matchMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {t("admin.bankReconciliation.confirmMatch")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Dismiss Dialog ─── */}
      <Dialog open={dismissDialogOpen} onOpenChange={setDismissDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("admin.bankReconciliation.dismissDialogTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.bankReconciliation.dismissDialogDesc")}
            </DialogDescription>
          </DialogHeader>

          {selectedTransaction && (
            <div className="space-y-4">
              <div className="bg-muted p-3 rounded-lg space-y-1">
                <p className="font-mono">
                  {formatCurrency(
                    selectedTransaction.amount,
                    selectedTransaction.currency,
                  )}{" "}
                  | {t("admin.bankReconciliation.vsLabel")} {selectedTransaction.variable_symbol || "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {selectedTransaction.sender_name || selectedTransaction.sender_account}
                </p>
              </div>

              <div>
                <Label>{t("admin.bankReconciliation.dismissReason")}</Label>
                <Input
                  className="mt-1"
                  value={dismissNotes}
                  onChange={(e) => setDismissNotes(e.target.value)}
                  placeholder={t("admin.bankReconciliation.dismissReasonPlaceholder")}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDismissDialogOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDismiss}
              disabled={dismissMutation.isPending}
            >
              {dismissMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {t("admin.bankReconciliation.confirmDismiss")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
