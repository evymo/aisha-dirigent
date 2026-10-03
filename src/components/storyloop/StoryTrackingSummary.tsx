/**
 * Story Tracking Summary
 * 
 * Compact health summary shown in StoryDetail header.
 * Shows key metrics at a glance.
 */

import { useTranslation } from 'react-i18next';
import { 
  Thermometer, 
  Zap, 
  Activity, 
  Moon,
  TrendingUp,
  TrendingDown,
  Minus,
  Flame
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { TrackingMetrics } from '@/hooks/useUserTracking';

interface StoryTrackingSummaryProps {
  metrics: TrackingMetrics | null;
  hasConsent: boolean;
  className?: string;
}

function TrendBadge({ trend }: { trend: 'improving' | 'stable' | 'declining' }) {
  const { t } = useTranslation();
  
  const config = {
    improving: { 
      icon: TrendingUp, 
      color: 'text-success bg-success/10 border-success/20',
      label: t('storyloop.trackingSummary.improving')
    },
    stable: { 
      icon: Minus, 
      color: 'text-muted-foreground bg-muted border-border',
      label: t('storyloop.trackingSummary.stable')
    },
    declining: { 
      icon: TrendingDown, 
      color: 'text-destructive bg-destructive/10 border-destructive/20',
      label: t('storyloop.trackingSummary.declining')
    },
  };
  
  const { icon: Icon, color, label } = config[trend];
  
  return (
    <Badge variant="outline" className={cn('gap-1 text-xs', color)}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

function MetricPill({ 
  icon: Icon, 
  value, 
  label,
  colorClass = 'text-muted-foreground'
}: { 
  icon: typeof Activity;
  value: number | null;
  label: string;
  colorClass?: string;
}) {
  if (value === null) return null;
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-muted/50 text-xs">
          <Icon className={cn('h-3 w-3', colorClass)} />
          <span className="font-medium">{Math.round(value * 10) / 10}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs">{label}: {Math.round(value * 10) / 10}/10</p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Renders a compact health summary for StoryLoop headers.
 */
export function StoryTrackingSummary({ 
  metrics, 
  hasConsent,
  className 
}: StoryTrackingSummaryProps) {
  const { t } = useTranslation();

  if (!hasConsent || !metrics) {
    return null;
  }

  const hasData = metrics.avg_pain_7d !== null || 
                  metrics.avg_energy_7d !== null || 
                  metrics.avg_mood_7d !== null ||
                  metrics.avg_sleep_7d !== null;

  if (!hasData) {
    return null;
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="text-xs text-muted-foreground lg:text-[13px]">
        {t('storyloop.trackingSummary.label')}:
      </span>
      
      <div className="flex flex-wrap items-center gap-1">
        <MetricPill 
          icon={Thermometer} 
          value={metrics.avg_pain_7d} 
          label={t('storyloop.trackingPanel.pain')}
          colorClass="text-destructive"
        />
        <MetricPill 
          icon={Zap} 
          value={metrics.avg_energy_7d} 
          label={t('storyloop.trackingPanel.energy')}
          colorClass="text-warning"
        />
        <MetricPill 
          icon={Activity} 
          value={metrics.avg_mood_7d} 
          label={t('storyloop.trackingPanel.mood')}
          colorClass="text-primary"
        />
        <MetricPill 
          icon={Moon} 
          value={metrics.avg_sleep_7d} 
          label={t('storyloop.trackingPanel.sleep')}
          colorClass="text-info"
        />
      </div>

      <TrendBadge trend={metrics.trend} />

      {metrics.checkin_streak > 0 && (
        <Badge variant="secondary" className="text-xs gap-1">
          <Flame className="h-3 w-3" /> {t('storyloop.days', { count: metrics.checkin_streak })}
        </Badge>
      )}
    </div>
  );
}
