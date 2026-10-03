import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Droplets, Clock, Calendar, Beaker, Info, Lock, FlaskConical } from "lucide-react";
import { useProductDistributionInfo, calculateBottleDuration } from "@/hooks/useDistributionProtocols";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

interface ProductDistributionInfoProps {
  productId: string;
  productName?: string;
}

export function ProductDistributionInfo({ productId, productName: _productName }: ProductDistributionInfoProps) {
  const { t } = useTranslation();
  const { distribution, hasCustomDistribution, loading, isAuthenticated } = useProductDistributionInfo(productId);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Not authenticated - show public info
  if (!isAuthenticated) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Droplets className="h-5 w-5 text-primary" />
            {t("distribution.title")}
          </CardTitle>
          <CardDescription>
            {t("distribution.signInForPersonalized")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <Lock className="h-4 w-4" />
            <AlertDescription>
              {t("distribution.memberOnlyInfo")}
              <Button asChild variant="link" className="p-0 h-auto ml-1">
                <Link to="/auth">{t("common.signIn")}</Link>
              </Button>
            </AlertDescription>
          </Alert>

          {/* Show general longevity distribution info */}
          <div className="mt-4 p-4 bg-muted/50 rounded-lg">
            <h4 className="font-medium mb-2 flex items-center gap-2">
              <Info className="h-4 w-4" />
              {t("distribution.longevityBasic")}
            </h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">{t("distribution.dailyDose")}:</span>
                <span className="ml-2 font-medium">20 {t("distribution.drops")} (2×10)</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t("distribution.timingLabel")}:</span>
                <span className="ml-2 font-medium">{t("distribution.morningEvening")}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t("distribution.bottleDuration")}:</span>
                <span className="ml-2 font-medium">~{t("distribution.days", { count: 30 })}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t("distribution.monthlyNeed")}:</span>
                <span className="ml-2 font-medium">1× 30ml</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Authenticated - check if user has study protocol for this product
  const activeDistribution = hasCustomDistribution ? distribution : null;

  // If user has no protocol for this product, show registration prompt
  if (!activeDistribution) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Droplets className="h-5 w-5 text-primary" />
            {t("distribution.title")}
          </CardTitle>
          <CardDescription>
            {t("distribution.noProtocolForProduct")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              {t("distribution.enrollToSeeDistribution")}
              <Button asChild variant="link" className="p-0 h-auto ml-1">
                <Link to="/studies">{t("distribution.viewStudies")}</Link>
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // User has protocol - show personalized distribution from study
  const displayDistribution = activeDistribution;

  const bottleCalc = displayDistribution?.dose_amount && displayDistribution?.doses_per_day
    ? calculateBottleDuration(
      displayDistribution.dose_amount,
      displayDistribution.doses_per_day,
      displayDistribution.dose_unit ?? 'drops'
    )
    : null;

  // Determine tier badge based on arm code
  const getTierBadge = () => {

    const armCode = activeDistribution.arm_code?.toUpperCase() ?? '';
    if (armCode.includes('BOO')) return <Badge className="bg-purple-500">{t("distribution.tiers.booster")}</Badge>;
    if (armCode.includes('INT')) return <Badge className="bg-orange-500">{t("distribution.tiers.intensive")}</Badge>;
    if (armCode.includes('BAS')) return <Badge>{t("distribution.tiers.basic")}</Badge>;
    if (armCode.includes('UDR')) return <Badge variant="outline">{t("distribution.tiers.maintenance")}</Badge>;
    if (armCode.includes('VER')) return <Badge variant="outline">{t("distribution.tiers.verification")}</Badge>;
    return <Badge variant="secondary">{t("distribution.tiers.longevity")}</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Droplets className="h-5 w-5 text-primary" />
            {t("distribution.yourDistribution")}
          </CardTitle>
          {getTierBadge()}
        </div>
        <CardDescription>
          {activeDistribution?.study_name
            ? t("distribution.studyProtocol", { study: activeDistribution.study_name })
            : t("distribution.standardLongevity")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Study info if enrolled */}
        {activeDistribution?.study_name && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-primary/5 p-2 rounded">
            <FlaskConical className="h-4 w-4" />
            <span>{activeDistribution.study_name}</span>
            {activeDistribution.arm_code && (
              <Badge variant="outline" className="ml-auto text-xs">{activeDistribution.arm_code}</Badge>
            )}
          </div>
        )}

        {/* Main distribution info */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Beaker className="h-4 w-4" />
              {t("distribution.singleDose")}
            </div>
            <div className="text-2xl font-bold">
              {displayDistribution?.dose_amount} {t(`distribution.units.${displayDistribution?.dose_unit ?? 'drops'}`)}
            </div>
          </div>

          <div className="p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Clock className="h-4 w-4" />
              {t("distribution.frequency")}
            </div>
            <div className="text-2xl font-bold">
              {displayDistribution?.doses_per_day}× {t("distribution.perDay")}
            </div>
          </div>
        </div>

        {/* Timing */}
        {displayDistribution?.dose_timing && displayDistribution.dose_timing.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <span className="text-sm text-muted-foreground">{t("distribution.when")}:</span>
            {displayDistribution.dose_timing.map((time) => (
              <Badge key={time} variant="outline" className="text-xs">
                {t(`distribution.timing.${time}`)}
              </Badge>
            ))}
          </div>
        )}

        {/* Bottle duration */}
        {bottleCalc && (
          <div className="p-4 border rounded-lg">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <Calendar className="h-4 w-4" />
              {t("distribution.supplyCalculation")}
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-lg font-bold">{bottleCalc.mlPerDay.toFixed(1)} ml</div>
                <div className="text-xs text-muted-foreground">{t("distribution.perDayShort")}</div>
              </div>
              <div>
                <div className="text-lg font-bold">{bottleCalc.daysPerBottle}</div>
                <div className="text-xs text-muted-foreground">{t("distribution.daysPerBottle")}</div>
              </div>
              <div>
                <div className="text-lg font-bold">{bottleCalc.bottlesPerMonth}</div>
                <div className="text-xs text-muted-foreground">{t("distribution.bottlesPerMonth")}</div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Compact distribution badge for product cards.
 */
export function ProductDistributionBadge({ productId }: { productId: string }) {
  const { t } = useTranslation();
  const { distribution, hasCustomDistribution, loading, isAuthenticated } = useProductDistributionInfo(productId);

  if (!isAuthenticated || loading) return null;

  if (hasCustomDistribution && distribution) {
    return (
      <Badge className="bg-primary/90">
        {distribution.doses_per_day}×{distribution.dose_amount} {t(`distribution.units.${distribution.dose_unit ?? 'drops'}`)}
      </Badge>
    );
  }

  return (
    <Badge variant="outline">
      2×10 {t("distribution.units.drops")}
    </Badge>
  );
}
