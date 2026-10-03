import { useState } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CreditCard,
  RefreshCw,
  DollarSign,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  RotateCcw,
  ExternalLink
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAdminPayments, Payment, processRefund } from "@/hooks/useAdminPayments";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { usePaymentColumns } from "./payments-columns";
import { safeError } from "@/lib/security/safeLogger";
import { useCurrency } from "@/hooks/useCurrency";

export default function AdminPayments() {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);
  const { formatCurrency, convertAmount, preferredCurrency } = useCurrency();

  const { data: payments = [], isLoading: loading, refetch } = useAdminPayments();

  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [processing, setProcessing] = useState(false);

  // Status Badge Logic (reused for Dialog)
  const getStatusBadge = (status: string) => {
    // We can define this locally or import constants if needed, 
    // but for the dialog we'll just do a simple implementation 
    // matching what was there or reusing logic if we exported constants.
    // For now, simple implementation for dialog consistency:
    const variant = status === 'paid' ? 'default' : status === 'payment_failed' ? 'destructive' : 'outline';
    return (
      <Badge variant={variant}>
        {t(`admin.payments.status.${status}`)}
      </Badge>
    );
  };

  const handleRefund = async () => {
    if (!selectedPayment?.stripe_payment_intent_id) return;

    setProcessing(true);
    try {
      await processRefund({
        paymentIntentId: selectedPayment.stripe_payment_intent_id,
        amount: refundAmount ? Math.round(parseFloat(refundAmount) * 100) : undefined,
      });

      toast.success(t("admin.payments.refundSuccess"));
      setRefundDialogOpen(false);
      setRefundAmount('');
      refetch();
    } catch (error) {
      safeError("Error processing refund", error);
      toast.error(t("admin.payments.refundError"));
    } finally {
      setProcessing(false);
    }
  };

  const stats = {
    totalRevenue: payments
      .filter(p => p.status === 'paid')
      .reduce((sum, p) => sum + convertAmount(p.amount, p.currency || preferredCurrency, preferredCurrency), 0),
    totalPayments: payments.length,
    successfulPayments: payments.filter(p => p.status === 'paid').length,
    failedPayments: payments.filter(p => p.status === 'payment_failed').length,
    pendingPayments: payments.filter(p => p.status === 'awaiting_payment').length,
    refundedPayments: payments.filter(p => p.status === 'refunded' || p.status === 'partially_refunded').length,
  };

  const columns = usePaymentColumns(
    (payment) => {
      setSelectedPayment(payment);
      setDetailOpen(true);
    },
    (payment) => {
      setSelectedPayment(payment);
      setRefundDialogOpen(true);
    },
    i18n.language
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">{t("admin.payments.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("admin.payments.subtitle")}</p>
        </div>
        <Button onClick={() => refetch()} variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          {t("common.refresh")}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-green-500" />
              <span className="text-sm text-muted-foreground">{t("admin.payments.stats.revenue")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">
              {formatCurrency(stats.totalRevenue, preferredCurrency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{t("admin.payments.stats.total")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{stats.totalPayments}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-sm text-muted-foreground">{t("admin.payments.stats.successful")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{stats.successfulPayments}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-sm text-muted-foreground">{t("admin.payments.stats.pending")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{stats.pendingPayments}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-500" />
              <span className="text-sm text-muted-foreground">{t("admin.payments.stats.failed")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{stats.failedPayments}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-blue-500" />
              <span className="text-sm text-muted-foreground">{t("admin.payments.stats.refunded")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{stats.refundedPayments}</p>
          </CardContent>
        </Card>
      </div>

      {/* Payments Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.payments.listTitle")}</CardTitle>
          <CardDescription>{t("admin.payments.listDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={payments}
            searchKey="stripe_payment_intent_id"
          />
        </CardContent>
      </Card>

      {/* Payment Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("admin.payments.detail.title")}</DialogTitle>
            <DialogDescription>{t("admin.payments.detail.description")}</DialogDescription>
          </DialogHeader>
          {selectedPayment && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">{t("admin.payments.detail.orderId")}</p>
                  <p className="font-mono text-sm">{selectedPayment.order_id}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("admin.payments.detail.paymentIntent")}</p>
                  <p className="font-mono text-sm">{selectedPayment.stripe_payment_intent_id || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("admin.payments.detail.amount")}</p>
                  <p className="font-semibold">
                    {formatCurrency(selectedPayment.amount, selectedPayment.currency)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("admin.payments.detail.status")}</p>
                  {getStatusBadge(selectedPayment.status)}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("admin.payments.detail.customer")}</p>
                  <p>{selectedPayment.profile?.display_name || '-'}</p>
                  <p className="text-sm text-muted-foreground">{selectedPayment.profile?.email || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("admin.payments.detail.date")}</p>
                  <p>{format(new Date(selectedPayment.created_at), "PPpp", { locale: dateLocale })}</p>
                </div>
              </div>
              {selectedPayment.stripe_payment_intent_id && (
                <div className="pt-4 border-t">
                  <Button
                    variant="outline"
                    asChild
                    className="w-full"
                  >
                    <a
                      href={`https://dashboard.stripe.com/payments/${selectedPayment.stripe_payment_intent_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />
                      {t("admin.payments.viewInStripe")}
                    </a>
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Refund Dialog */}
      <Dialog open={refundDialogOpen} onOpenChange={setRefundDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.payments.refund.title")}</DialogTitle>
            <DialogDescription>{t("admin.payments.refund.description")}</DialogDescription>
          </DialogHeader>
          {selectedPayment && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.payments.refund.originalAmount")}</p>
                <p className="font-semibold">
                  {formatCurrency(selectedPayment.amount, selectedPayment.currency)}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("admin.payments.refund.refundAmount")}</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max={selectedPayment.amount}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  placeholder={t("admin.payments.refund.fullRefundPlaceholder")}
                />
                <p className="text-xs text-muted-foreground">
                  {t("admin.payments.refund.leaveEmptyForFull")}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleRefund}
              disabled={processing}
            >
              {processing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("admin.payments.refund.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
