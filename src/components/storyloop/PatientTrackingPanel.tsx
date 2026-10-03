/**
 * User Tracking Panel
 * 
 * Displays user's health data in StoryLoop:
 * - Tracking check-ins (pain, energy, mood, sleep)
 * - Medication/product logs
 * - Trends visualization
 * 
 * Data visibility controlled by MemberAccessCard consent level.
 */

import { useTranslation } from 'react-i18next';
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { 
  Activity, 
  Heart, 
  Moon, 
  Zap, 
  Thermometer,
  Pill,
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  Lock,
  AlertCircle,
  Stethoscope,
  Clock
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Locale } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { format, isToday, isYesterday } from 'date-fns';
import { useUserTrackingData, type TrackingCheckIn, type DosingLog, type TrackingMetrics, type SymptomLog } from '@/hooks/useUserTracking';

interface UserTrackingPanelProps {
  userId: string;
  className?: string;
}

interface RelativeDateLabels {
  today: string;
  yesterday: string;
}

// Helper to format relative date
function formatRelativeDate(dateStr: string, locale: Locale, labels: RelativeDateLabels): string {
  const date = new Date(dateStr);
  if (isToday(date)) return labels.today;
  if (isYesterday(date)) return labels.yesterday;
  return format(date, 'EEE, MMM d', { locale });
}

// Trend indicator component
function TrendIndicator({ trend }: { trend: TrackingMetrics['trend'] | null }) {
  if (!trend) return null;
  
  switch (trend) {
    case 'improving':
      return <TrendingUp className="h-3 w-3 text-success" />;
    case 'declining':
      return <TrendingDown className="h-3 w-3 text-destructive" />;
    case 'stable':
    default:
      return <Minus className="h-3 w-3 text-muted-foreground" />;
  }
}

// Metric card component
function MetricCard({ 
  icon: Icon, 
  label, 
  value, 
  unit, 
  max = 10,
  showProgress = false,
  className
}: { 
  icon: typeof Activity;
  label: string;
  value: number | null;
  unit?: string;
  max?: number;
  showProgress?: boolean;
  className?: string;
}) {
  const displayValue = value !== null ? value : '—';
  const progressValue = value !== null ? (value / max) * 100 : 0;
  
  return (
    <div className={cn('flex items-center gap-3 p-3 rounded-lg bg-muted/30', className)}>
      <div className="p-2 rounded-full bg-background">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold">
            {displayValue}
            {unit && <span className="text-sm font-normal text-muted-foreground ml-0.5">{unit}</span>}
          </span>
        </div>
        {showProgress && value !== null && (
          <Progress value={progressValue} className="h-1.5 mt-1" />
        )}
      </div>
    </div>
  );
}

// Check-in row component
function CheckInRow({
  checkIn,
  locale,
  relativeLabels,
}: {
  checkIn: TrackingCheckIn;
  locale: Locale;
  relativeLabels: RelativeDateLabels;
}) {
  const { t } = useTranslation();
  
  return (
    <div className="py-3 border-b border-border last:border-0">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium">
            {formatRelativeDate(checkIn.check_in_date, locale, relativeLabels)}
          </span>
        </div>
      </div>
      
      <div className="grid grid-cols-4 gap-2">
        {checkIn.pain_level !== null && (
          <div className="text-center">
            <Thermometer className="h-3.5 w-3.5 mx-auto text-destructive/70" />
            <p className="text-xs text-muted-foreground mt-0.5">{t('storyloop.trackingPanel.pain')}</p>
            <p className="text-sm font-medium">{checkIn.pain_level}/10</p>
          </div>
        )}
        {checkIn.energy_level !== null && (
          <div className="text-center">
            <Zap className="h-3.5 w-3.5 mx-auto text-warning" />
            <p className="text-xs text-muted-foreground mt-0.5">{t('storyloop.trackingPanel.energy')}</p>
            <p className="text-sm font-medium">{checkIn.energy_level}/10</p>
          </div>
        )}
        {checkIn.mood_level !== null && (
          <div className="text-center">
            <Activity className="h-3.5 w-3.5 mx-auto text-primary" />
            <p className="text-xs text-muted-foreground mt-0.5">{t('storyloop.trackingPanel.mood')}</p>
            <p className="text-sm font-medium">{checkIn.mood_level}/10</p>
          </div>
        )}
        {checkIn.sleep_quality !== null && (
          <div className="text-center">
            <Moon className="h-3.5 w-3.5 mx-auto text-info" />
            <p className="text-xs text-muted-foreground mt-0.5">{t('storyloop.trackingPanel.sleep')}</p>
            <p className="text-sm font-medium">{checkIn.sleep_quality}/10</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Dosing log row
function DosingLogRow({ log, locale }: { log: DosingLog; locale: Locale }) {
  const { t } = useTranslation();

  const productName = log.product_name ?? t('storyloop.trackingPanel.unknownProduct');

  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <div className="flex items-center gap-2">
        <Pill className="h-4 w-4 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">{productName}</p>
          {log.dose_count !== null && (
            <p className="text-xs text-muted-foreground">
              {t('storyloop.trackingPanel.doseCount', { count: log.dose_count })}
            </p>
          )}
        </div>
      </div>
      <div className="text-right">
        <span className="text-xs text-muted-foreground">
          {format(new Date(log.logged_at), 'MMM d, HH:mm', { locale })}
        </span>
      </div>
    </div>
  );
}

// Symptom log row
function SymptomLogRow({ log, locale }: { log: SymptomLog; locale: Locale }) {
  const { t } = useTranslation();

  const symptomName = log.symptom_name ?? log.symptom_code ?? t('storyloop.trackingPanel.unknownSymptom');
  const severityPercent = log.severity !== null ? (log.severity / 10) * 100 : 0;

  // Calculate duration if both dates available
  let durationText: string | null = null;
  if (log.started_at && log.ended_at) {
    const startMs = new Date(log.started_at).getTime();
    const endMs = new Date(log.ended_at).getTime();
    const diffHours = Math.round((endMs - startMs) / (1000 * 60 * 60));
    if (diffHours < 24) {
      durationText = t('storyloop.trackingPanel.symptomDurationHours', { count: diffHours });
    } else {
      const diffDays = Math.round(diffHours / 24);
      durationText = t('storyloop.trackingPanel.symptomDurationDays', { count: diffDays });
    }
  }

  const isOngoing = log.started_at && !log.ended_at;

  return (
    <div className="py-3 border-b border-border last:border-0">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Stethoscope className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{symptomName}</span>
        </div>
        <div className="flex items-center gap-2">
          {isOngoing && (
            <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">
              {t('storyloop.trackingPanel.symptomOngoing')}
            </Badge>
          )}
          {durationText && !isOngoing && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {durationText}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 mt-1">
        {log.severity !== null && (
          <div className="flex items-center gap-2 flex-1">
            <span className="text-xs text-muted-foreground w-16">
              {t('storyloop.trackingPanel.symptomSeverity')}
            </span>
            <Progress
              value={severityPercent}
              className={cn('h-2 flex-1', {
                '[&>div]:bg-success': log.severity <= 3,
                '[&>div]:bg-warning': log.severity > 3 && log.severity <= 6,
                '[&>div]:bg-destructive': log.severity > 6,
              })}
            />
            <span className="text-xs font-medium w-8 text-right">{log.severity}/10</span>
          </div>
        )}
      </div>

      {log.notes && (
        <p className="text-xs text-muted-foreground mt-1.5 italic line-clamp-2">{log.notes}</p>
      )}

      <div className="flex items-center justify-between mt-1.5">
        {log.category && (
          <Badge variant="secondary" className="text-[10px]">
            {log.category}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {format(new Date(log.logged_at), 'MMM d, HH:mm', { locale })}
        </span>
      </div>
    </div>
  );
}

// No consent placeholder
function NoConsentPlaceholder() {
  const { t } = useTranslation();
  
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="p-4 rounded-full bg-muted mb-4">
        <Lock className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">
        {t('storyloop.trackingPanel.noConsent')}
      </h3>
      <p className="text-sm text-muted-foreground max-w-sm">
        {t('storyloop.trackingPanel.noConsentDesc')}
      </p>
    </div>
  );
}

// Loading skeleton
function TrackingPanelSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-40" />
      <Skeleton className="h-32" />
    </div>
  );
}

/**
 * Displays consent-gated user health data within StoryLoop.
 *
 * Consent is checked INTERNALLY by `useUserTrackingData` — no external bypass.
 */
export function UserTrackingPanel({ 
  userId,
  className
}: UserTrackingPanelProps) {
  const { t, i18n } = useTranslation();
  const locale = getDateFnsLocale(i18n.language);
  const relativeLabels: RelativeDateLabels = {
    today: t('storyloop.trackingPanel.relative.today'),
    yesterday: t('storyloop.trackingPanel.relative.yesterday'),
  };

  // Consent is checked internally — hook is fail-closed
  const { checkIns, dosingLogs, symptomLogs, metrics, consentStatus, isConsentLoading, isLoading } = useUserTrackingData(userId);

  if (isConsentLoading || isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" />
            {t('storyloop.trackingPanel.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TrackingPanelSkeleton />
        </CardContent>
      </Card>
    );
  }

  if (consentStatus !== 'granted') {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" />
            {t('storyloop.trackingPanel.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <NoConsentPlaceholder />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            {t('storyloop.trackingPanel.title')}
          </div>
          <div className="flex items-center gap-2">
            {metrics && <TrendIndicator trend={metrics.trend} />}
            <Badge variant="outline" className="text-xs font-normal">
              {t('storyloop.trackingPanel.last7Days')}
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-4 h-8">
            <TabsTrigger value="overview" className="text-xs">
              {t('storyloop.trackingPanel.tabs.overview')}
            </TabsTrigger>
            <TabsTrigger value="checkins" className="text-xs">
              {t('storyloop.trackingPanel.tabs.checkIns')}
            </TabsTrigger>
            <TabsTrigger value="symptoms" className="text-xs">
              {t('storyloop.trackingPanel.tabs.symptoms')}
            </TabsTrigger>
            <TabsTrigger value="meds" className="text-xs">
              {t('storyloop.trackingPanel.tabs.meds')}
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="mt-4">
            <div className="grid grid-cols-2 gap-3">
              <MetricCard
                icon={Thermometer}
                label={t('storyloop.trackingPanel.avgPain')}
                value={metrics?.avg_pain_7d ?? null}
                max={10}
                showProgress
              />
              <MetricCard
                icon={Zap}
                label={t('storyloop.trackingPanel.avgEnergy')}
                value={metrics?.avg_energy_7d ?? null}
                max={10}
                showProgress
              />
              <MetricCard
                icon={Activity}
                label={t('storyloop.trackingPanel.avgMood')}
                value={metrics?.avg_mood_7d ?? null}
                max={10}
                showProgress
              />
              <MetricCard
                icon={Moon}
                label={t('storyloop.trackingPanel.avgSleep')}
                value={metrics?.avg_sleep_7d ?? null}
                max={10}
                showProgress
              />
            </div>

            {metrics && metrics.checkin_streak > 0 && (
              <div className="mt-4 p-3 rounded-lg bg-muted/30 flex items-center gap-3">
                <div className="p-2 rounded-full bg-primary/10">
                  <Heart className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {t('storyloop.trackingPanel.dayStreak', { count: metrics.checkin_streak })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('storyloop.trackingPanel.lastCheckIn')}: {metrics.last_checkin_date ? formatRelativeDate(metrics.last_checkin_date, locale, relativeLabels) : '—'}
                  </p>
                </div>
              </div>
            )}

            {checkIns.length === 0 && (
              <div className="flex flex-col items-center py-8 text-center">
                <AlertCircle className="h-8 w-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">
                  {t('storyloop.trackingPanel.noData')}
                </p>
              </div>
            )}
          </TabsContent>

          {/* Check-ins Tab */}
          <TabsContent value="checkins" className="mt-4">
            <ScrollArea className="h-[280px]">
              {checkIns.length > 0 ? (
                checkIns.slice(0, 14).map((checkIn) => (
                  <CheckInRow
                    key={checkIn.id}
                    checkIn={checkIn}
                    locale={locale}
                    relativeLabels={relativeLabels}
                  />
                ))
              ) : (
                <div className="flex flex-col items-center py-8 text-center">
                  <Activity className="h-8 w-8 text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {t('storyloop.trackingPanel.noCheckIns')}
                  </p>
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* Medications Tab */}
          <TabsContent value="meds" className="mt-4">
            <ScrollArea className="h-[280px]">
              {dosingLogs.length > 0 ? (
                dosingLogs.slice(0, 20).map((log, idx) => (
                  <DosingLogRow key={`${log.logged_at}-${idx}`} log={log} locale={locale} />
                ))
              ) : (
                <div className="flex flex-col items-center py-8 text-center">
                  <Pill className="h-8 w-8 text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {t('storyloop.trackingPanel.noMeds')}
                  </p>
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* Symptoms Tab */}
          <TabsContent value="symptoms" className="mt-4">
            <ScrollArea className="h-[280px]">
              {symptomLogs.length > 0 ? (
                symptomLogs.slice(0, 20).map((log) => (
                  <SymptomLogRow key={log.id} log={log} locale={locale} />
                ))
              ) : (
                <div className="flex flex-col items-center py-8 text-center">
                  <Stethoscope className="h-8 w-8 text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {t('storyloop.trackingPanel.noSymptoms')}
                  </p>
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
