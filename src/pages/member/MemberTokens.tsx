import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/hooks/useSession";
import { useTokens, TokenType, TransactionType } from "@/hooks/useTokens";
import { 
  Coins, Vote, Heart, Database, TrendingUp, TrendingDown,
  Gift, ArrowRightLeft, Clock, Loader2, Info, Flame, Lock, Unlock
} from "lucide-react";

export default function MemberTokens() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useSession();
  const { balance, totalTokens, transactions, loading } = useTokens();

  const TOKEN_CONFIG: Record<TokenType, { 
    labelKey: string; 
    icon: typeof Coins; 
    color: string;
    bgColor: string;
    descriptionKey: string;
  }> = {
    aisha: {
      labelKey: "tokens.types.aisha",
      icon: Coins,
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
      descriptionKey: "tokens.descriptions.aisha",
    },
    governance: { 
      labelKey: "tokens.types.governance", 
      icon: Vote, 
      color: "text-primary",
      bgColor: "bg-primary/10",
      descriptionKey: "tokens.descriptions.governance",
    },
    impact: { 
      labelKey: "tokens.types.impact", 
      icon: Heart, 
      color: "text-rose-500",
      bgColor: "bg-rose-500/10",
      descriptionKey: "tokens.descriptions.impact",
    },
    data: { 
      labelKey: "tokens.types.data", 
      icon: Database, 
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
      descriptionKey: "tokens.descriptions.data",
    },
  };

  const TRANSACTION_CONFIG: Record<TransactionType, {
    labelKey: string;
    icon: typeof TrendingUp;
    color: string;
  }> = {
    earned: { labelKey: "tokens.transactions.earned", icon: TrendingUp, color: "text-green-500" },
    spent: { labelKey: "tokens.transactions.spent", icon: TrendingDown, color: "text-red-500" },
    transferred: { labelKey: "tokens.transactions.transferred", icon: ArrowRightLeft, color: "text-blue-500" },
    bonus: { labelKey: "tokens.transactions.bonus", icon: Gift, color: "text-purple-500" },
    expired: { labelKey: "tokens.transactions.expired", icon: Clock, color: "text-muted-foreground" },
    reward: { labelKey: "tokens.transactions.reward", icon: Gift, color: "text-green-500" },
    transfer: { labelKey: "tokens.transactions.transfer", icon: ArrowRightLeft, color: "text-blue-500" },
    burn: { labelKey: "tokens.transactions.burn", icon: Flame, color: "text-orange-500" },
    lock: { labelKey: "tokens.transactions.lock", icon: Lock, color: "text-amber-500" },
    unlock: { labelKey: "tokens.transactions.unlock", icon: Unlock, color: "text-teal-500" },
  };

  const isKnownTokenType = (value: unknown): value is TokenType =>
    typeof value === "string" && Object.prototype.hasOwnProperty.call(TOKEN_CONFIG, value);

  const isKnownTransactionType = (value: unknown): value is TransactionType =>
    typeof value === "string" && Object.prototype.hasOwnProperty.call(TRANSACTION_CONFIG, value);

  const location = useLocation();
  
  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth", { state: { from: location }, replace: true });
    }
  }, [user, authLoading, navigate, location]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const maxTokens = Math.max(totalTokens, 100);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 py-12 pt-24">
        <div className="container max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <div className="p-3 rounded-full bg-primary/10">
              <Coins className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-serif font-bold">{t("tokens.title")}</h1>
              <p className="text-muted-foreground">
                {t("tokens.subtitle")}
              </p>
            </div>
          </div>

          {/* Total Balance */}
          <Card className="mb-8 bg-gradient-to-br from-primary/5 to-secondary/5 border-primary/20">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm text-muted-foreground">{t("tokens.totalBalance")}</p>
                  <p className="text-4xl font-bold">{totalTokens.toLocaleString()}</p>
                  <p className="text-sm text-muted-foreground">{t("tokens.aishaTokens")}</p>
                </div>
                <div className="text-right">
                  <Badge variant="outline" className="text-lg px-4 py-1">
                    <Coins className="w-4 h-4 mr-2" />
                    {t("tokens.active")}
                  </Badge>
                </div>
              </div>
              <Progress value={(totalTokens / maxTokens) * 100} className="h-2" />
            </CardContent>
          </Card>

          {/* Token Breakdown */}
          <div className="grid md:grid-cols-4 gap-4 mb-8">
            {(Object.keys(TOKEN_CONFIG) as TokenType[]).map((tokenType) => {
              const config = TOKEN_CONFIG[tokenType];
              const tokenBalance = balance[tokenType];
              
              return (
                <Card key={tokenType} className="relative overflow-hidden">
                  <div className={`absolute inset-0 ${config.bgColor} opacity-50`} />
                  <CardContent className="pt-6 relative">
                    <div className="flex items-start justify-between mb-3">
                      <div className={`p-2 rounded-lg ${config.bgColor}`}>
                        <config.icon className={`w-5 h-5 ${config.color}`} />
                      </div>
                      <p className="text-3xl font-bold">{tokenBalance}</p>
                    </div>
                    <div>
                      <p className="font-medium">{t(config.labelKey)}</p>
                      <p className="text-xs text-muted-foreground">{t(config.labelKey)} {t("tokens.tokensLabel")}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">{t(config.descriptionKey)}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Token Usage Info */}
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="w-5 h-5" />
                {t("tokens.howToUse.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Vote className="w-4 h-4 text-primary" />
                    <span className="font-medium">{t("tokens.howToUse.governance.title")}</span>
                  </div>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• {t("tokens.howToUse.governance.voting")}</li>
                    <li>• {t("tokens.howToUse.governance.exclusive")}</li>
                    <li>• {t("tokens.howToUse.governance.advisory")}</li>
                  </ul>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Heart className="w-4 h-4 text-rose-500" />
                    <span className="font-medium">{t("tokens.howToUse.impact.title")}</span>
                  </div>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• {t("tokens.howToUse.impact.support")}</li>
                    <li>• {t("tokens.howToUse.impact.research")}</li>
                    <li>• {t("tokens.howToUse.impact.charity")}</li>
                  </ul>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-amber-500" />
                    <span className="font-medium">{t("tokens.howToUse.data.title")}</span>
                  </div>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• {t("tokens.howToUse.data.discounts")}</li>
                    <li>• {t("tokens.howToUse.data.diagnostics")}</li>
                    <li>• {t("tokens.howToUse.data.premium")}</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Transaction History */}
          <Card>
            <CardHeader>
              <CardTitle>{t("tokens.transactionHistory.title")}</CardTitle>
              <CardDescription>
                {t("tokens.transactionHistory.subtitle")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="all" className="w-full">
                <TabsList className="mb-4">
                  <TabsTrigger value="all">{t("tokens.transactionHistory.all")}</TabsTrigger>
                  <TabsTrigger value="governance">{t("tokens.types.governance")}</TabsTrigger>
                  <TabsTrigger value="impact">{t("tokens.types.impact")}</TabsTrigger>
                  <TabsTrigger value="data">{t("tokens.types.data")}</TabsTrigger>
                </TabsList>

                {(["all", "governance", "impact", "data"] as const).map((tab) => (
                  <TabsContent key={tab} value={tab}>
                    {transactions.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <Coins className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <p>{t("tokens.transactionHistory.noTransactions")}</p>
                        <p className="text-sm mt-1">
                          {t("tokens.transactionHistory.earnTokens")}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {transactions
                          .filter((t) => tab === "all" || t.token_type === tab)
                          .map((transaction) => {
                            const tokenType: TokenType = isKnownTokenType(transaction.token_type)
                              ? transaction.token_type
                              : "governance";
                            const transactionType: TransactionType = isKnownTransactionType(
                              transaction.transaction_type
                            )
                              ? transaction.transaction_type
                              : "earned";
                            const tokenConfig = TOKEN_CONFIG[tokenType];
                            const txConfig = TRANSACTION_CONFIG[transactionType];
                            const isPositive = transaction.amount > 0;

                            return (
                              <div
                                key={transaction.id}
                                className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                              >
                                <div className="flex items-center gap-3">
                                  <div className={`p-2 rounded-lg ${tokenConfig.bgColor}`}>
                                    <txConfig.icon className={`w-4 h-4 ${txConfig.color}`} />
                                  </div>
                                  <div>
                                    <p className="font-medium">
                                      {transaction.description || t(txConfig.labelKey)}
                                    </p>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                      <Badge variant="outline" className="text-xs">
                                        {t(tokenConfig.labelKey)}
                                      </Badge>
                                      <span>
                                        {new Date(transaction.created_at).toLocaleDateString("cs-CZ", {
                                          day: "numeric",
                                          month: "short",
                                          year: "numeric",
                                        })}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className={`font-bold ${isPositive ? "text-green-500" : "text-red-500"}`}>
                                    {isPositive ? "+" : ""}{transaction.amount}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {t("tokens.transactionHistory.balance")}: {transaction.balance_after}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </main>

      <Footer />
    </div>
  );
}
