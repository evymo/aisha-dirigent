import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Coins } from "lucide-react";
import { TOKEN_ICONS, TOKEN_COLORS } from "./constants";
import type { TokenConfig } from "@/hooks/useTokenomics";

interface TokenOverviewCardProps {
  config: TokenConfig;
}

export function TokenOverviewCard({ config }: TokenOverviewCardProps) {
  const { t } = useTranslation();

  const Icon = TOKEN_ICONS[config.token_type] || Coins;
  const colorClass = TOKEN_COLORS[config.token_type] || "text-primary";
  const circulatingPercent = config.total_supply > 0
    ? (config.circulating_supply / config.total_supply) * 100
    : 0;

  return (
    <Card>
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
}
