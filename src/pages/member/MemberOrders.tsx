import { useEffect, useState, useCallback } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/hooks/useSession";
import { useMyOrders, MemberOrder } from "@/hooks/useMemberOrders";
import { useOrderInvoiceData } from "@/hooks/useOrderInvoiceData";
import { useInvoiceHeaderConfig } from "@/hooks/useInvoiceSettings";
import { printInvoice } from "@/lib/invoicePdf";
import { useCurrency } from "@/hooks/useCurrency";
import { Package, ShoppingBag, Loader2, Star, Clock, Edit, CreditCard, Building2, FileText } from "lucide-react";
import { useOrderReviews, OrderReview } from "@/hooks/useOrderReviews";
import { OrderReviewDialog } from "@/components/orders/OrderReviewDialog";
import { BankTransferQrCode } from "@/components/orders/BankTransferQrCode";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function MemberOrders() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoading: authLoading } = useSession();
  const { formatCurrency } = useCurrency();
  
  const { data: orders = [], isLoading: ordersLoading } = useMyOrders(!!user);
  const { data: invoiceHeader } = useInvoiceHeaderConfig();
  const [invoiceOrderId, setInvoiceOrderId] = useState<string | null>(null);
  const { data: invoiceData } = useOrderInvoiceData(invoiceOrderId ?? undefined, !!invoiceOrderId);

  // When invoice data is loaded, print and reset
  useEffect(() => {
    if (invoiceData && invoiceHeader && invoiceOrderId) {
      try {
        printInvoice({ invoiceHeader, order: invoiceData });
      } catch {
        toast.error(t("orders.invoice.printError"));
      }
      setInvoiceOrderId(null);
    }
  }, [invoiceData, invoiceHeader, invoiceOrderId, t]);

  const handlePrintInvoice = useCallback((orderId: string) => {
    setInvoiceOrderId(orderId);
  }, []);
  
  const [reviews, setReviews] = useState<Record<string, OrderReview>>({});
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<MemberOrder | null>(null);
  const { getReviewForOrder, canReviewOrder, daysUntilReviewable } = useOrderReviews();

  const STATUS_LABELS: Record<string, { labelKey: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    pending: { labelKey: "orders.status.pending", variant: "secondary" },
    confirmed: { labelKey: "orders.status.confirmed", variant: "default" },
    processing: { labelKey: "orders.status.processing", variant: "default" },
    shipped: { labelKey: "orders.status.shipped", variant: "default" },
    delivered: { labelKey: "orders.status.delivered", variant: "outline" },
    cancelled: { labelKey: "orders.status.cancelled", variant: "destructive" },
  };

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth", { state: { from: location }, replace: true });
    }
  }, [user, authLoading, navigate, location]);

  // Fetch reviews for delivered orders
  useEffect(() => {
    const fetchReviews = async () => {
      const reviewPromises = orders
        .filter(o => o.status === 'delivered')
        .map(async (order) => {
          const review = await getReviewForOrder(order.id);
          return { orderId: order.id, review };
        });

      const reviewResults = await Promise.all(reviewPromises);
      const reviewsMap: Record<string, OrderReview> = {};
      reviewResults.forEach(({ orderId, review }) => {
        if (review) {
          reviewsMap[orderId] = review;
        }
      });
      setReviews(reviewsMap);
    };

    if (orders.length > 0) {
      fetchReviews();
    }
  }, [orders, getReviewForOrder]);

  const handleOpenReview = (order: MemberOrder) => {
    setSelectedOrder(order);
    setReviewDialogOpen(true);
  };

  const loading = authLoading || ordersLoading;

  const handleReviewSuccess = async () => {
    if (selectedOrder) {
      const review = await getReviewForOrder(selectedOrder.id);
      if (review) {
        setReviews(prev => ({ ...prev, [selectedOrder.id]: review }));
      }
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 py-12 pt-24">
        <div className="container max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <div className="p-3 rounded-full bg-primary/10">
              <Package className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-serif font-bold">{t("orders.title")}</h1>
              <p className="text-muted-foreground">
                {t("orders.subtitle")}
              </p>
            </div>
          </div>

          {/* Orders List */}
          {orders.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <ShoppingBag className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">{t("orders.noOrders")}</h3>
                <p className="text-muted-foreground mb-6">
                  {t("orders.noOrdersDescription")}
                </p>
                <Button asChild>
                  <Link to="/shop">{t("orders.browseShop")}</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {orders.map((order) => {
                const statusConfig = STATUS_LABELS[order.status] || STATUS_LABELS.pending;
                const review = reviews[order.id];
                const isDelivered = order.status === 'delivered';
                const canReview = isDelivered && canReviewOrder(order.delivered_at);
                const daysLeft = isDelivered ? daysUntilReviewable(order.delivered_at) : 0;

                return (
                  <Card key={order.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-base">
                            {t("orders.orderNumber")} #{order.id.slice(0, 8).toUpperCase()}
                          </CardTitle>
                          <CardDescription>
                            {new Date(order.created_at).toLocaleDateString("cs-CZ", {
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                            })}
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={statusConfig.variant}>
                            {t(statusConfig.labelKey)}
                          </Badge>
                          {order.payment_method === "bank_transfer" && (
                            <Badge variant="outline" className="gap-1">
                              <Building2 className="h-3 w-3" />
                              {t("orders.paymentMethod.bankTransfer")}
                            </Badge>
                          )}
                          {order.payment_method === "card" && (
                            <Badge variant="outline" className="gap-1">
                              <CreditCard className="h-3 w-3" />
                              {t("orders.paymentMethod.card")}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {order.order_items && order.order_items.length > 0 && (
                        <div className="space-y-2 mb-4">
                          {order.order_items.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center justify-between text-sm py-2 border-b last:border-0"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground">
                                  {item.quantity}{t("common.multiplierTimes")}
                                </span>
                                <span>{item.product?.name || t("orders.product")}</span>
                              </div>
                              <span className="font-medium">
                                {formatCurrency(item.price_at_purchase * item.quantity, order.currency)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-between pt-2 border-t">
                        <span className="font-medium">{t("orders.total")}</span>
                        <span className="text-lg font-bold">
                          {formatCurrency(order.total, order.currency)}
                        </span>
                      </div>

                      {/* Bank transfer pending info */}
                      {order.payment_method === "bank_transfer" && order.status === "pending" && order.variable_symbol && (
                        <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <Building2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                            <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
                              {t("orders.bankTransfer.awaitingPayment")}
                            </span>
                          </div>
                          <div className="text-sm text-amber-700 dark:text-amber-300 space-y-1">
                            <div className="flex justify-between">
                              <span>{t("orders.bankTransfer.variableSymbol")}:</span>
                              <span className="font-mono font-medium">{order.variable_symbol}</span>
                            </div>
                            {order.bank_transfer_due_date && (
                              <div className="flex justify-between">
                                <span>{t("orders.bankTransfer.dueDate")}:</span>
                                <span className="font-medium">
                                  {new Date(order.bank_transfer_due_date).toLocaleDateString("cs-CZ")}
                                </span>
                              </div>
                            )}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-2 w-full"
                            asChild
                          >
                            <Link to={`/checkout/bank-transfer/${order.id}`}>
                              {t("orders.bankTransfer.viewDetails")}
                            </Link>
                          </Button>
                          {/* QR code for bank transfer */}
                          {order.bank_transfer_iban && (
                            <div className="mt-3 pt-3 border-t border-amber-200 dark:border-amber-800">
                              <BankTransferQrCode
                                data={{
                                  amount: order.bank_transfer_amount ?? order.total,
                                  bic: order.bank_transfer_bic,
                                  currency: order.currency,
                                  iban: order.bank_transfer_iban,
                                  variableSymbol: order.variable_symbol,
                                }}
                                compact
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {/* Invoice Download */}
                      {order.invoice_number && (
                        <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm">
                                {t("orders.invoice.label")}: <span className="font-mono font-medium">{order.invoice_number}</span>
                              </span>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handlePrintInvoice(order.id)}
                            >
                              <FileText className="h-4 w-4 mr-1" />
                              {t("orders.invoice.download")}
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Review Section */}
                      {isDelivered && (
                        <div className="mt-4 pt-4 border-t">
                          {review ? (
                            <div className="flex items-start justify-between">
                              <div>
                                <div className="flex items-center gap-1 mb-1">
                                  {[1, 2, 3, 4, 5].map((star) => (
                                    <Star
                                      key={star}
                                      className={cn(
                                        "h-4 w-4",
                                        star <= review.rating
                                          ? "fill-amber-400 text-amber-400"
                                          : "text-muted-foreground/30"
                                      )}
                                    />
                                  ))}
                                  <span className="text-sm text-muted-foreground ml-2">
                                    {t("orderReview.yourReview")}
                                  </span>
                                </div>
                                {review.comment && (
                                  <p className="text-sm text-muted-foreground">{review.comment}</p>
                                )}
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenReview(order)}
                              >
                                <Edit className="h-4 w-4 mr-1" />
                                {t("common.edit")}
                              </Button>
                            </div>
                          ) : canReview ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenReview(order)}
                            >
                              <Star className="h-4 w-4 mr-2" />
                              {t("orderReview.leaveReview")}
                            </Button>
                          ) : (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Clock className="h-4 w-4" />
                              {t("orderReview.availableIn", { days: daysLeft })}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </main>

      <Footer />

      {selectedOrder && (
        <OrderReviewDialog
          open={reviewDialogOpen}
          onOpenChange={setReviewDialogOpen}
          orderId={selectedOrder.id}
          existingReview={reviews[selectedOrder.id]}
          onSuccess={handleReviewSuccess}
        />
      )}
    </div>
  );
}
