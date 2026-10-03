/**
 * TokenBalanceDisplay - Detailed token view with transaction history
 */

import { useTranslation } from "react-i18next";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { Award, Coins, Database, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTokens, TokenTransaction } from "@/hooks/useTokens";
import { cn } from "@/lib/utils";
import { format, Locale } from "date-fns";
interface TokenBalanceDisplayProps {
  className?: string;
  showHistory?: boolean;
  historyLimit?: number;
}

export function TokenBalanceDisplay({
  className,
  showHistory = true,
  historyLimit = 5,
}: TokenBalanceDisplayProps) {
  const { t, i18n } = useTranslation();
  const { balance, totalTokens, transactions, loading } = useTokens();

  const dateLocale = getDateFnsLocale(i18n.language);

  if (loading) {
    return (
      <Card className={cn("animate-pulse", className)}>
        <CardContent className="p-6">
          <div className="h-32 bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  const tokenCards = [
    {
      type: "governance",
      label: t("gamification.widget.governance"),
      value: balance.governance,
      icon: Award,
      color: "bg-chart-1/10 text-chart-1 border-chart-1/20",
    },
    {
      type: "impact",
      label: t("gamification.widget.impact"),
      value: balance.impact,
      icon: Coins,
      color: "bg-chart-2/10 text-chart-2 border-chart-2/20",
    },
    {
      type: "data",
      label: t("gamification.widget.data"),
      value: balance.data,
      icon: Database,
      color: "bg-chart-3/10 text-chart-3 border-chart-3/20",
    },
  ];

  const recentTransactions = transactions.slice(0, historyLimit);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Total Balance Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">
            {t("gamification.balance.total")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-4xl font-bold text-primary mb-4">
            {totalTokens}
            <span className="text-base font-normal text-muted-foreground ml-2">
              {t("gamification.balance.tokens")}
            </span>
          </div>

          {/* Token breakdown */}
          <div className="grid grid-cols-3 gap-3">
            {tokenCards.map((token) => (
              <div
                key={token.type}
                className={cn(
                  "rounded-lg border p-3 text-center",
                  token.color
                )}
              >
                <token.icon className="h-5 w-5 mx-auto mb-1" />
                <div className="text-xl font-semibold">{token.value}</div>
                <div className="text-xs opacity-80">{token.label}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Transaction History */}
      {showHistory && recentTransactions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t("gamification.history.recent")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentTransactions.map((tx) => (
                <TransactionItem
                  key={tx.id}
                  transaction={tx}
                  dateLocale={dateLocale}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface TransactionItemProps {
  transaction: TokenTransaction;
  dateLocale: Locale;
}

function TransactionItem({ transaction, dateLocale }: TransactionItemProps) {
  const isPositive = transaction.amount > 0;

  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2">
        {isPositive ? (
          <TrendingUp className="h-4 w-4 text-chart-2" />
        ) : (
          <TrendingDown className="h-4 w-4 text-destructive" />
        )}
        <div>
          <div className="font-medium">
            {transaction.description || transaction.transaction_type}
          </div>
          <div className="text-xs text-muted-foreground">
            {format(new Date(transaction.created_at), "d. MMM yyyy", {
              locale: dateLocale,
            })}
          </div>
        </div>
      </div>
      <div
        className={cn(
          "font-medium",
          isPositive ? "text-chart-2" : "text-destructive"
        )}
      >
        {isPositive ? "+" : ""}
        {transaction.amount}
      </div>
    </div>
  );
}
