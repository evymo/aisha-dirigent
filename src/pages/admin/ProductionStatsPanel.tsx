import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTokenRewardRules } from "@/hooks/useTokenomics";
import { useProductionTokenStats, AUTOMATIC_TRIGGERS, PRODUCTION_TOKEN_FLOW } from "@/hooks/useProductionTokens";
import {
    Coins, Flame, TrendingUp, Activity, AlertTriangle, Zap, Factory, CheckCircle
} from "lucide-react";

export function ProductionStatsPanel() {
    const { t } = useTranslation();
    const { data: rewardRules } = useTokenRewardRules();
    const { data: productionStats } = useProductionTokenStats();

    return (
        <div className="space-y-6">
            {/* Production Token Flow */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Factory className="w-5 h-5" />
                        {t("admin.tokenomics.productionFlow")}
                    </CardTitle>
                    <CardDescription>
                        {t("admin.tokenomics.productionFlowDesc")}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                            <div className="flex items-center gap-2 mb-2">
                                <Coins className="w-5 h-5 text-green-500" />
                                <span className="font-medium text-green-700 dark:text-green-400">
                                    {t("admin.tokenomics.minted")}
                                </span>
                            </div>
                            <p className="text-2xl font-bold text-green-600">+{productionStats?.totalMinted.toFixed(2) || 0}</p>
                            <p className="text-sm text-muted-foreground">
                                {productionStats?.mintEvents || 0} {t("admin.tokenomics.events")}
                            </p>
                        </div>
                        <div className="p-4 rounded-lg bg-orange-500/10 border border-orange-500/20">
                            <div className="flex items-center gap-2 mb-2">
                                <Flame className="w-5 h-5 text-orange-500" />
                                <span className="font-medium text-orange-700 dark:text-orange-400">
                                    {t("admin.tokenomics.burnedLoss")}
                                </span>
                            </div>
                            <p className="text-2xl font-bold text-orange-600">-{productionStats?.totalBurned.toFixed(2) || 0}</p>
                            <p className="text-sm text-muted-foreground">
                                {productionStats?.burnEvents || 0} {t("admin.tokenomics.lossEvents")}
                            </p>
                        </div>
                        <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                            <div className="flex items-center gap-2 mb-2">
                                <TrendingUp className="w-5 h-5 text-primary" />
                                <span className="font-medium">
                                    {t("admin.tokenomics.netProduction")}
                                </span>
                            </div>
                            <p className={`text-2xl font-bold ${(productionStats?.netTokens || 0) >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                                {(productionStats?.netTokens || 0) >= 0 ? '+' : ''}{productionStats?.netTokens.toFixed(2) || 0}
                            </p>
                            <p className="text-sm text-muted-foreground">
                                {t("admin.tokenomics.impactTokens")}
                            </p>
                        </div>
                        <div className="p-4 rounded-lg bg-muted border">
                            <div className="flex items-center gap-2 mb-2">
                                <Activity className="w-5 h-5" />
                                <span className="font-medium">
                                    {t("admin.tokenomics.efficiency")}
                                </span>
                            </div>
                            <p className="text-2xl font-bold">{productionStats?.efficiencyRate.toFixed(1) || 100}%</p>
                            <p className="text-sm text-muted-foreground">
                                {productionStats?.totalVolume.toFixed(1) || 0}
                                {t("admin.tokenomics.units.litersShort")}{" "}
                                {t("admin.tokenomics.processed")}
                            </p>
                        </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                        <div className="p-4 rounded-lg border bg-card">
                            <h4 className="font-medium mb-2 flex items-center gap-2">
                                <Coins className="w-4 h-4 text-green-500" />
                                {t("admin.tokenomics.mintingRule")}
                            </h4>
                            <p className="text-sm text-muted-foreground mb-1">
                                <strong>{PRODUCTION_TOKEN_FLOW.minting.trigger}</strong>
                            </p>
                            <p className="text-sm">{PRODUCTION_TOKEN_FLOW.minting.rate}</p>
                            <p className="text-xs text-muted-foreground mt-1">{PRODUCTION_TOKEN_FLOW.minting.description}</p>
                        </div>
                        <div className="p-4 rounded-lg border bg-card">
                            <h4 className="font-medium mb-2 flex items-center gap-2">
                                <Flame className="w-4 h-4 text-orange-500" />
                                {t("admin.tokenomics.burningRule")}
                            </h4>
                            <p className="text-sm text-muted-foreground mb-1">
                                <strong>{PRODUCTION_TOKEN_FLOW.burning.trigger}</strong>
                            </p>
                            <p className="text-sm">{PRODUCTION_TOKEN_FLOW.burning.rate}</p>
                            <p className="text-xs text-muted-foreground mt-1">{PRODUCTION_TOKEN_FLOW.burning.description}</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Automatic Triggers */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Zap className="w-5 h-5 text-amber-500" />
                        {t("admin.tokenomics.automaticTriggers")}
                    </CardTitle>
                    <CardDescription>
                        {t("admin.tokenomics.triggersDesc")}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
                        {AUTOMATIC_TRIGGERS.map((trigger) => {
                            const rule = rewardRules?.find(r => r.action_type === trigger.action);
                            const isActive = rule?.is_active ?? false;
                            return (
                                <div
                                    key={trigger.action}
                                    className={`p-3 rounded-lg border ${isActive ? 'bg-green-500/5 border-green-500/20' : 'bg-muted/50 border-muted'}`}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="font-medium text-sm">{rule?.action_name_key || trigger.action}</span>
                                        {isActive ? (
                                            <CheckCircle className="w-4 h-4 text-green-500" />
                                        ) : (
                                            <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                                        )}
                                    </div>
                                    <p className="text-xs text-muted-foreground mb-1">{trigger.description}</p>
                                    {isActive && rule && (
                                        <Badge variant="secondary" className="text-xs">
                                            +{Math.round(rule.base_amount * rule.multiplier)} {rule.token_type}
                                        </Badge>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
