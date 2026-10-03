import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOrdersAdmin, useUpdateOrderStatus, type Order } from "@/hooks/useAdminOrders";
import { useGenerateInvoice } from "@/hooks/useGenerateInvoice";
import { useOrderInvoiceData } from "@/hooks/useOrderInvoiceData";
import { useInvoiceHeaderConfig } from "@/hooks/useInvoiceSettings";
import { printInvoice } from "@/lib/invoicePdf";
import { useCurrency } from "@/hooks/useCurrency";
import { Package, ShoppingBag, CheckCircle, XCircle, Clock, Loader2, CreditCard, Building2, FileText, Printer } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { useOrderColumns } from "./orders-columns";

const ORDER_STATUSES = [
  { value: "pending", labelKey: "orders.status.pending", icon: Clock },
  { value: "confirmed", labelKey: "orders.status.confirmed", icon: CheckCircle },
  { value: "processing", labelKey: "orders.status.processing", icon: Package },
  { value: "shipped", labelKey: "orders.status.shipped", icon: Package /* Reused icon */ }, // Truck not imported in quick fix, focusing on structure
  { value: "delivered", labelKey: "orders.status.delivered", icon: CheckCircle },
  { value: "cancelled", labelKey: "orders.status.cancelled", icon: XCircle },
];

export default function AdminOrders() {
  const { t } = useTranslation();
  const { formatCurrency } = useCurrency();
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const { data: orders = [], isLoading: loading } = useOrdersAdmin();
  const updateStatusMutation = useUpdateOrderStatus();
  const generateInvoiceMutation = useGenerateInvoice();
  const { data: invoiceHeader } = useInvoiceHeaderConfig();
  const { data: invoiceData } = useOrderInvoiceData(
    selectedOrder?.id,
    detailOpen && !!selectedOrder
  );
  const updating = updateStatusMutation.isPending ? updateStatusMutation.variables?.orderId : null;

  const handleStatusChange = async (orderId: string, newStatus: string) => {
    try {
      await updateStatusMutation.mutateAsync({ orderId, status: newStatus });
      toast.success(t("admin.orders.statusUpdated"));
    } catch {
      toast.error(t("admin.orders.updateError"));
    }
  };

  const handleGenerateInvoice = useCallback(async (orderId: string) => {
    try {
      const result = await generateInvoiceMutation.mutateAsync({ orderId });
      if (result.already_existed) {
        toast.info(t("admin.orders.invoice.alreadyExists", { number: result.invoice_number }));
      } else {
        toast.success(t("admin.orders.invoice.generated", { number: result.invoice_number }));
      }
      // Update selected order in-place
      if (selectedOrder?.id === orderId) {
        setSelectedOrder({
          ...selectedOrder,
          invoice_number: result.invoice_number,
          invoice_generated_at: new Date().toISOString(),
        });
      }
    } catch {
      toast.error(t("admin.orders.invoice.generateError"));
    }
  }, [generateInvoiceMutation, selectedOrder, t]);

  const handlePrintInvoice = useCallback(() => {
    if (!invoiceData || !invoiceHeader) return;
    try {
      printInvoice({ invoiceHeader, order: invoiceData });
    } catch {
      toast.error(t("admin.orders.invoice.printError"));
    }
  }, [invoiceData, invoiceHeader, t]);

  const getStatusBadgeVariant = (status: string): "default" | "secondary" | "outline" | "destructive" => {
    switch (status) {
      case "confirmed":
      case "processing":
      case "shipped":
        return "default";
      case "delivered":
        return "secondary";
      case "cancelled":
        return "destructive";
      default:
        return "outline";
    }
  };

  const stats = {
    total: orders.length,
    pending: orders.filter((o) => o.status === "pending").length,
    processing: orders.filter((o) => ["confirmed", "processing", "shipped"].includes(o.status)).length,
    delivered: orders.filter((o) => o.status === "delivered").length,
    cancelled: orders.filter((o) => o.status === "cancelled").length,
  };

  const columns = useOrderColumns(
    handleStatusChange,
    (order) => {
      setSelectedOrder(order);
      setDetailOpen(true);
    },
    updating
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
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">{t("admin.orders.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("admin.orders.subtitle")}</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{t("admin.orders.stats.total")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-sm text-muted-foreground">{t("admin.orders.stats.pending")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{stats.pending}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-primary" />
              <span className="text-sm text-muted-foreground">{t("admin.orders.stats.processing")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{stats.processing}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-sm text-muted-foreground">{t("admin.orders.stats.delivered")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{stats.delivered}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-destructive" />
              <span className="text-sm text-muted-foreground">{t("admin.orders.stats.cancelled")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{stats.cancelled}</p>
          </CardContent>
        </Card>
      </div>

      {/* Orders Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5" />
              {t("admin.orders.listTitle")}
            </span>
          </CardTitle>
          <CardDescription>{t("admin.orders.listSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={orders}
            searchKey="id"
          />
        </CardContent>
      </Card>

      {/* Order Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t("admin.orders.detail.title")} #{selectedOrder?.id.slice(0, 8).toUpperCase()}
            </DialogTitle>
            <DialogDescription>
              {selectedOrder && new Date(selectedOrder.created_at).toLocaleString("cs-CZ")}
            </DialogDescription>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-6">
              {/* Customer Info */}
              <div>
                <h4 className="font-medium mb-2">{t("admin.orders.detail.customer")}</h4>
                <div className="bg-muted/50 p-4 rounded-lg space-y-1">
                  <p>{selectedOrder.user_name || t("admin.orders.unknownCustomer")}</p>
                  {selectedOrder.user_email && (
                    <p className="text-sm text-muted-foreground">{selectedOrder.user_email}</p>
                  )}
                </div>
              </div>

              {/* Items */}
              <div>
                <h4 className="font-medium mb-2">{t("admin.orders.detail.items")}</h4>
                <div className="space-y-2">
                  {selectedOrder.order_items.map((item) => (
                    <div key={item.id} className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground inline-flex items-baseline gap-0.5">
                          <span>{item.quantity}</span>
                          <span>{t("common.multiplierTimes")}</span>
                        </span>
                        <span>{t("orders.product")}</span>
                      </div>
                      <span className="font-medium">
                        <span className="inline-flex items-baseline gap-1">
                          {formatCurrency(item.price_at_purchase * item.quantity, selectedOrder.currency)}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Total */}
              <div className="flex justify-between items-center pt-4 border-t">
                <span className="font-medium">{t("orders.total")}</span>
                <span className="text-xl font-bold">
                  <span className="inline-flex items-baseline gap-1">
                    {formatCurrency(selectedOrder.total, selectedOrder.currency)}
                  </span>
                </span>
              </div>

              {/* Payment Info */}
              <div className="pt-4 border-t">
                <h4 className="font-medium mb-2">{t("admin.orders.detail.paymentInfo")}</h4>
                <div className="bg-muted/50 p-4 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{t("admin.orders.detail.paymentMethod")}</span>
                    <Badge variant="outline" className="flex items-center gap-1">
                      {selectedOrder.payment_method === "bank_transfer" ? (
                        <><Building2 className="w-3 h-3" />{t("orders.paymentMethod.bankTransfer")}</>
                      ) : (
                        <><CreditCard className="w-3 h-3" />{t("orders.paymentMethod.card")}</>
                      )}
                    </Badge>
                  </div>
                  {selectedOrder.payment_status && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{t("admin.orders.detail.paymentStatus")}</span>
                      <Badge variant={selectedOrder.payment_status === "paid" ? "default" : "outline"}>
                        {t(`orders.paymentStatus.${selectedOrder.payment_status}`)}
                      </Badge>
                    </div>
                  )}
                  {selectedOrder.payment_method === "bank_transfer" && selectedOrder.variable_symbol && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{t("admin.orders.detail.variableSymbol")}</span>
                      <span className="font-mono text-sm">{selectedOrder.variable_symbol}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Status */}
              <div className="flex items-center justify-between pt-4 border-t">
                <span className="font-medium">{t("admin.orders.detail.status")}</span>
                <Select
                  value={selectedOrder.status}
                  onValueChange={(value) => {
                    handleStatusChange(selectedOrder.id, value);
                    setSelectedOrder({ ...selectedOrder, status: value });
                  }}
                >
                  <SelectTrigger className="w-[180px]">
                    <Badge variant={getStatusBadgeVariant(selectedOrder.status)}>
                      {t(`orders.status.${selectedOrder.status}`)}
                    </Badge>
                  </SelectTrigger>
                  <SelectContent>
                    {ORDER_STATUSES.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        <div className="flex items-center gap-2">
                          <status.icon className="w-4 h-4" />
                          {t(status.labelKey)}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Invoice */}
              <div className="pt-4 border-t">
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  {t("admin.orders.detail.invoice")}
                </h4>
                <div className="bg-muted/50 p-4 rounded-lg space-y-3">
                  {selectedOrder.invoice_number ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">{t("admin.orders.detail.invoiceNumber")}</span>
                        <span className="font-mono text-sm font-medium">{selectedOrder.invoice_number}</span>
                      </div>
                      {selectedOrder.invoice_generated_at && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">{t("admin.orders.detail.invoiceDate")}</span>
                          <span className="text-sm">{new Date(selectedOrder.invoice_generated_at).toLocaleString("cs-CZ")}</span>
                        </div>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={handlePrintInvoice}
                        disabled={!invoiceData || !invoiceHeader}
                      >
                        <Printer className="w-4 h-4 mr-2" />
                        {t("admin.orders.detail.printInvoice")}
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">{t("admin.orders.detail.noInvoice")}</p>
                      <Button
                        variant="default"
                        size="sm"
                        className="w-full"
                        onClick={() => handleGenerateInvoice(selectedOrder.id)}
                        disabled={generateInvoiceMutation.isPending}
                      >
                        {generateInvoiceMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <FileText className="w-4 h-4 mr-2" />
                        )}
                        {t("admin.orders.detail.generateInvoice")}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
