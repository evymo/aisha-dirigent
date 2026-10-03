import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useTokenConfigs, useTokenRewardRules, useTokenLocks, useTokenBurns, useTokenAllocations } from "@/hooks/useTokenomics";
import { Coins, Flame, Lock, Gift, Settings, TrendingUp, Loader2, History, Ticket, Trophy, Vote } from "lucide-react";

import { TOKEN_ICONS, TOKEN_COLORS } from "./tokenomics-constants";
import { TokenConfigsPanel } from "./TokenConfigsPanel";
import { RewardRulesPanel } from "./RewardRulesPanel";
import { LocksPanel } from "./LocksPanel";
import { BurnsPanel } from "./BurnsPanel";
import { AllocationsPanel } from "./AllocationsPanel";
import { TransactionsPanel } from "./TransactionsPanel";
import { ProductionStatsPanel } from "./ProductionStatsPanel";
import { VouchersPanel } from "./VouchersPanel";
import { LeaderboardRewardsPanel } from "./LeaderboardRewardsPanel";
import { GovernancePanel } from "./GovernancePanel";

export default function AdminTokenomics() {
  const { t } = useTranslation();

  const { data: tokenConfigs, isLoading: configsLoading } = useTokenConfigs();
  const { data: rewardRules, isLoading: rulesLoading } = useTokenRewardRules();
  const { data: tokenLocks, isLoading: locksLoading } = useTokenLocks();
  const { data: tokenBurns, isLoading: burnsLoading } = useTokenBurns();
  const { isLoading: allocationsLoading } = useTokenAllocations();

  const isLoading = configsLoading || rulesLoading || locksLoading || burnsLoading || allocationsLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("admin.tokenomics.title")}</h1>
          <p className="text-muted-foreground">{t("admin.tokenomics.subtitle")}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">
              <TrendingUp className="w-4 h-4 mr-2" />
              {t("admin.tokenomics.tabs.overview")}
            </TabsTrigger>
            <TabsTrigger value="rewards">
              <Gift className="w-4 h-4 mr-2" />
              {t("admin.tokenomics.tabs.rewards")}
            </TabsTrigger>
            <TabsTrigger value="transactions">
              <History className="w-4 h-4 mr-2" />
              {t("admin.tokenomics.tabs.transactions")}
            </TabsTrigger>
            <TabsTrigger value="allocations">
              <Coins className="w-4 h-4 mr-2" />
              {t("admin.tokenomics.tabs.allocations")}
            </TabsTrigger>
            <TabsTrigger value="locks">
              <Lock className="w-4 h-4 mr-2" />
              {t("admin.tokenomics.tabs.locks")}
            </TabsTrigger>
            <TabsTrigger value="burns">
              <Flame className="w-4 h-4 mr-2" />
              {t("admin.tokenomics.tabs.burns")}
            </TabsTrigger>
            <TabsTrigger value="config">
              <Settings className="w-4 h-4 mr-2" />
              {t("admin.tokenomics.tabs.config")}
            </TabsTrigger>
            <TabsTrigger value="vouchers">
              <Ticket className="w-4 h-4 mr-2" />
              {t("admin.tokenomics.tabs.vouchers")}
            </TabsTrigger>
            <TabsTrigger value="leaderboard-rewards">
              <Trophy className="w-4 h-4 mr-2" />
              {t("admin.tokenomics.tabs.leaderboardRewards")}
            </TabsTrigger>
            <TabsTrigger value="governance">
              <Vote className="w-4 h-4 mr-2" />
              {t("admin.tokenomics.tabs.governance")}
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* Token Overview Cards */}
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              {tokenConfigs?.map((config) => {
                const Icon = TOKEN_ICONS[config.token_type] || Coins;
                const colorClass = TOKEN_COLORS[config.token_type] || "text-primary";
                const circulatingPercent = config.total_supply > 0
                  ? (config.circulating_supply / config.total_supply) * 100
                  : 0;

                return (
                  <Card key={config.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Icon className={`w-5 h-5 ${colorClass}`} />
                          <CardTitle className="text-lg">{config.symbol}</CardTitle>
                        </div>
                        <Badge variant={config.is_active ? "default" : "secondary"}>
                          {config.is_active ? t("common.active") : t("common.inactive")}
                        </Badge>
                      </div>
                      <CardDescription>{config.name}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-muted-foreground">{t("admin.tokenomics.circulating")}</span>
                            <span>{circulatingPercent.toFixed(1)}%</span>
                          </div>
                          <Progress value={circulatingPercent} className="h-2" />
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <p className="text-muted-foreground">{t("admin.tokenomics.totalSupply")}</p>
                            <p className="font-semibold">{config.total_supply.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">{t("admin.tokenomics.circulating")}</p>
                            <p className="font-semibold">{config.circulating_supply.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">{t("admin.tokenomics.locked")}</p>
                            <p className="font-semibold">{config.locked_supply.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">{t("admin.tokenomics.burned")}</p>
                            <p className="font-semibold text-destructive">{config.burned_supply.toLocaleString()}</p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Quick Stats */}
            <div className="grid md:grid-cols-3 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Gift className="w-5 h-5" />
                    {t("admin.tokenomics.activeRewardRules")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">
                    {rewardRules?.filter(r => r.is_active).length || 0}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t("admin.tokenomics.of")} {rewardRules?.length || 0} {t("admin.tokenomics.total")}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Lock className="w-5 h-5" />
                    {t("admin.tokenomics.activeLocks")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">
                    {tokenLocks?.filter(l => l.is_active).length || 0}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {tokenLocks?.filter(l => l.is_active).reduce((sum, l) => sum + l.amount, 0).toLocaleString()} {t("admin.tokenomics.tokensLocked")}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Flame className="w-5 h-5 text-destructive" />
                    {t("admin.tokenomics.totalBurned")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-destructive">
                    {tokenBurns?.reduce((sum, b) => sum + b.amount, 0).toLocaleString() || 0}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {tokenBurns?.length || 0} {t("admin.tokenomics.burnEvents")}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Production Stats */}
            <ProductionStatsPanel />
          </TabsContent>

          {/* Reward Rules Tab */}
          <TabsContent value="rewards" className="space-y-6">
            <RewardRulesPanel />
          </TabsContent>

          {/* Transactions Tab */}
          <TabsContent value="transactions" className="space-y-4">
            <TransactionsPanel />
          </TabsContent>

          {/* Allocations Tab */}
          <TabsContent value="allocations" className="space-y-4">
            <AllocationsPanel />
          </TabsContent>

          {/* Locks Tab */}
          <TabsContent value="locks" className="space-y-4">
            <LocksPanel />
          </TabsContent>

          {/* Burns Tab */}
          <TabsContent value="burns" className="space-y-4">
            <BurnsPanel />
          </TabsContent>

          {/* Config Tab */}
          <TabsContent value="config" className="space-y-4">
            <TokenConfigsPanel />
          </TabsContent>

          {/* Vouchers Tab */}
          <TabsContent value="vouchers" className="space-y-4">
            <VouchersPanel />
          </TabsContent>

          {/* Leaderboard Rewards Tab */}
          <TabsContent value="leaderboard-rewards" className="space-y-4">
            <LeaderboardRewardsPanel />
          </TabsContent>

          {/* Governance Tab */}
          <TabsContent value="governance" className="space-y-4">
            <GovernancePanel />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
