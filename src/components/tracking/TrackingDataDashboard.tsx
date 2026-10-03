import { useTranslation } from 'react-i18next';
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { Activity, Heart, Moon, Flame, Scale, MapPin, Footprints, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  useTrackingDataSync,
  useTrackingSyncAvailability,
  trackingDataFormatters,
  type TrackingDataType,
} from '@/hooks/useTrackingDataSync';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
const dataTypeIcons: Record<TrackingDataType, React.ElementType> = {
  steps: Footprints,
  heart_rate: Heart,
  blood_pressure: Activity,
  sleep: Moon,
  active_energy: Flame,
  weight: Scale,
  distance: MapPin,
};

const dataTypeColors: Record<TrackingDataType, string> = {
  steps: 'text-green-500',
  heart_rate: 'text-red-500',
  blood_pressure: 'text-purple-500',
  sleep: 'text-indigo-500',
  active_energy: 'text-orange-500',
  weight: 'text-blue-500',
  distance: 'text-cyan-500',
};

interface TrackingMetricCardProps {
  type: TrackingDataType;
  value: number | undefined;
  unit: string;
  goal?: number;
  trend?: 'up' | 'down' | 'stable';
}

const TrackingMetricCard = ({ type, value, unit, goal, trend }: TrackingMetricCardProps) => {
  const { t } = useTranslation();
  const Icon = dataTypeIcons[type];
  const colorClass = dataTypeColors[type];
  const formatter = trackingDataFormatters[type];
  const progress = goal && value ? Math.min((value / goal) * 100, 100) : undefined;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={cn('h-5 w-5', colorClass)} />
            <CardTitle className="text-sm font-medium">
              {t(`tracking.dataTypes.${type}`)}
            </CardTitle>
          </div>
          {trend && (
            <Badge variant={trend === 'up' ? 'default' : trend === 'down' ? 'destructive' : 'secondary'}>
              {trend === 'up' ? '+' : trend === 'down' ? '-' : '='}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {value !== undefined ? (
          <>
            <p className="text-2xl font-bold">
              {formatter(value)}
            </p>
            {progress !== undefined && (
              <div className="mt-2">
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-muted-foreground mt-1">
                  {Math.round(progress)}% {t('common.of')} {goal?.toLocaleString()} {unit}
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">{t('tracking.noDataAvailable')}</p>
        )}
      </CardContent>
    </Card>
  );
};

interface TrackingDataDashboardProps {
  className?: string;
  showSyncButton?: boolean;
  compact?: boolean;
}

export const TrackingDataDashboard = ({ className, showSyncButton = true, compact = false }: TrackingDataDashboardProps) => {
  const { t, i18n } = useTranslation();
  const locale = getDateFnsLocale(i18n.language);

  const {
    summary,
    healthData,
    isLoading,
    isSyncing,
    refetch,
    getLatestValue,
  } = useTrackingDataSync({ summaryDays: 7 });

  const { isAnyAvailable, platform } = useTrackingSyncAvailability();

  // Get latest distance value for metrics that need individual records
  const latestDistance = getLatestValue('distance');

  // Last sync time (most recent record)
  const lastSyncTime = healthData.length > 0
    ? new Date(healthData[0].created_at)
    : null;

  if (isLoading) {
    return (
      <div className={cn('space-y-4', className)}>
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className={cn('grid gap-4', compact ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{t('tracking.summary')}</h3>
          {lastSyncTime && (
            <p className="text-sm text-muted-foreground">
              {t('tracking.lastSync')}: {formatDistanceToNow(lastSyncTime, { addSuffix: true, locale })}
            </p>
          )}
        </div>
        {showSyncButton && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isSyncing}
          >
            <RefreshCw className={cn('h-4 w-4 mr-2', isSyncing && 'animate-spin')} />
            {t('tracking.syncNow')}
          </Button>
        )}
      </div>

      {/* Platform indicator */}
      {isAnyAvailable && (
        <Badge variant="outline" className="w-fit">
          {platform === 'ios' ? t('tracking.healthKit.connected') : t('tracking.healthConnect.connected')}
        </Badge>
      )}

      {/* Metrics grid */}
      <div className={cn(
        'grid gap-4',
        compact
          ? 'grid-cols-2 md:grid-cols-3'
          : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
      )}>
        <TrackingMetricCard
          type="steps"
          value={summary?.steps?.avg_daily}
          unit={t('tracking.units.steps')}
          goal={10000}
        />
        <TrackingMetricCard
          type="heart_rate"
          value={summary?.heart_rate?.avg}
          unit={t('tracking.units.bpm')}
        />
        <TrackingMetricCard
          type="sleep"
          value={summary?.sleep?.avg_hours}
          unit={t('tracking.units.hours')}
          goal={8}
        />
        <TrackingMetricCard
          type="active_energy"
          value={summary?.active_energy?.avg_daily}
          unit={t('tracking.units.kcal')}
          goal={500}
        />
        <TrackingMetricCard
          type="weight"
          value={summary?.weight?.latest}
          unit={summary?.weight?.unit ?? 'kg'}
        />
        <TrackingMetricCard
          type="distance"
          value={latestDistance?.value}
          unit={t('tracking.units.km')}
        />
      </div>

      {/* Weekly summary */}
      {summary && !compact && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('tracking.periods.week')}</CardTitle>
            <CardDescription>
              {t('tracking.summary')} - {t('storyloop.days', { count: 7 })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">{t('tracking.dataTypes.steps')}</p>
                <p className="text-xl font-semibold">{summary.steps?.total?.toLocaleString() ?? 0}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('tracking.dataTypes.sleep')}</p>
                <p className="text-xl font-semibold">{summary.sleep?.total_hours?.toFixed(1) ?? 0}h</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('tracking.dataTypes.active_energy')}</p>
                <p className="text-xl font-semibold">{summary.active_energy?.total?.toLocaleString() ?? 0} kcal</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('tracking.dataTypes.heart_rate')} (avg)</p>
                <p className="text-xl font-semibold">{Math.round(summary.heart_rate?.avg ?? 0)} bpm</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default TrackingDataDashboard;
