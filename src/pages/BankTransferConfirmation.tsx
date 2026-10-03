import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useOrderBankTransfer } from "@/hooks/useOrderBankTransfer";
import { useCurrency } from "@/hooks/useCurrency";
import { BankTransferQrCode } from "@/components/orders/BankTransferQrCode";
import { Building2, CheckCircle, Copy, Loader2, Package } from "lucide-react";
import { toast } from "sonner";
import { useCallback } from "react";

/**
 * Bank Transfer Confirmation page.
 * Shown after order creation with bank_transfer payment method.
 * Displays IBAN, BIC, variable symbol, amount and due date.
 */
export default function BankTransferConfirmation() {
  const { t } = useTranslation();
  const { orderId } = useParams<{ orderId: string }>();
  const { formatCurrency } = useCurrency();

  const { data: bankTransfer, isLoading, error } = useOrderBankTransfer(orderId);

  const copyToClipboard = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(t("checkout.bankTransfer.copied"), {
          description: t("checkout.bankTransfer.copiedDesc", { field: label }),
        });
      } catch {
        // Fallback for non-HTTPS
        const textarea = document.createElement("textarea");
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        toast.success(t("checkout.bankTransfer.copied"), {
          description: t("checkout.bankTransfer.copiedDesc", { field: label }),
        });
      }
    },
    [t],
  );

  const formatIban = (iban: string) => {
    return iban
      .replace(/\s/g, "")
      .replace(/(.{4})/g, "$1 ")
      .trim();
  };

  const formatDueDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString("cs-CZ", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !bankTransfer) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="pt-32 pb-24">
          <div className="container mx-auto px-4 max-w-2xl text-center">
            <Package className="h-16 w-16 text-muted-foreground mx-auto mb-6" />
            <h1 className="font-serif text-3xl font-bold mb-4">
              {t("checkout.bankTransfer.orderNotFound")}
            </h1>
            <p className="text-muted-foreground mb-8">
              {t("checkout.bankTransfer.orderNotFoundDesc")}
            </p>
            <Button asChild>
              <Link to="/member/orders">{t("checkout.bankTransfer.goToOrders")}</Link>
            </Button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const detailRows: Array<{
    label: string;
    value: string;
    copyable?: boolean;
    highlight?: boolean;
  }> = [
    {
      label: t("checkout.bankTransfer.iban"),
      value: bankTransfer.bank_transfer_iban
        ? formatIban(bankTransfer.bank_transfer_iban)
        : "—",
      copyable: !!bankTransfer.bank_transfer_iban,
    },
    {
      label: t("checkout.bankTransfer.bic"),
      value: bankTransfer.bank_transfer_bic || "—",
      copyable: !!bankTransfer.bank_transfer_bic,
    },
    {
      label: t("checkout.bankTransfer.variableSymbol"),
      value: bankTransfer.variable_symbol || "—",
      copyable: !!bankTransfer.variable_symbol,
      highlight: true,
    },
    {
      label: t("checkout.bankTransfer.amount"),
      value: bankTransfer.bank_transfer_amount != null
        ? formatCurrency(bankTransfer.bank_transfer_amount, bankTransfer.currency)
        : formatCurrency(bankTransfer.total, bankTransfer.currency),
      copyable: false,
      highlight: true,
    },
    {
      label: t("checkout.bankTransfer.dueDate"),
      value: bankTransfer.bank_transfer_due_date
        ? formatDueDate(bankTransfer.bank_transfer_due_date)
        : "—",
      copyable: false,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="pt-32 pb-24">
        <div className="container mx-auto px-4 max-w-2xl">
          {/* Success banner */}
          <div className="flex items-center gap-4 mb-8 p-6 bg-primary/10 border border-primary/20 rounded-lg">
            <CheckCircle className="h-10 w-10 text-primary flex-shrink-0" />
            <div>
              <h1 className="font-serif text-2xl font-bold text-foreground">
                {t("checkout.bankTransfer.orderCreated")}
              </h1>
              <p className="text-muted-foreground mt-1">
                {t("checkout.bankTransfer.orderCreatedDesc")}
              </p>
            </div>
          </div>

          {/* Order reference */}
          <p className="text-sm text-muted-foreground mb-6">
            {t("checkout.bankTransfer.orderRef")}{" "}
            <span className="font-mono font-medium text-foreground">
              #{(orderId ?? "").slice(0, 8).toUpperCase()}
            </span>
          </p>

          {/* Bank transfer payment details */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-primary/10">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle>{t("checkout.bankTransfer.paymentDetails")}</CardTitle>
                  <CardDescription>
                    {t("checkout.bankTransfer.paymentDetailsDesc")}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {detailRows.map((row) => (
                  <div key={row.label}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{row.label}</span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-mono text-sm ${row.highlight ? "text-lg font-bold text-foreground" : "text-foreground"}`}
                        >
                          {row.value}
                        </span>
                        {row.copyable && row.value !== "—" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() =>
                              copyToClipboard(row.value.replace(/\s/g, ""), row.label)
                            }
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <Separator className="mt-3" />
                  </div>
                ))}
              </div>

              {/* Important notice */}
              <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
                <p className="text-sm text-amber-800 dark:text-amber-200 font-medium mb-1">
                  {t("checkout.bankTransfer.importantTitle")}
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  {t("checkout.bankTransfer.importantDesc")}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* QR code for bank transfer */}
          {bankTransfer.bank_transfer_iban && (
            <div className="mt-6">
              <BankTransferQrCode
                data={{
                  amount: bankTransfer.bank_transfer_amount ?? bankTransfer.total,
                  bic: bankTransfer.bank_transfer_bic,
                  currency: bankTransfer.currency,
                  iban: bankTransfer.bank_transfer_iban,
                  variableSymbol: bankTransfer.variable_symbol,
                }}
              />
            </div>
          )}

          {/* Actions */}
          <div className="mt-8 flex flex-col sm:flex-row gap-4">
            <Button asChild className="flex-1">
              <Link to="/member/orders">{t("checkout.bankTransfer.goToOrders")}</Link>
            </Button>
            <Button variant="outline" asChild className="flex-1">
              <Link to="/shop">{t("checkout.bankTransfer.continueShopping")}</Link>
            </Button>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
