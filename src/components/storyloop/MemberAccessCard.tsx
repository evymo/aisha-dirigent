/**
 * Member Access Card
 * 
 * Displays member information with access level indicators.
 * Respects data sharing consent - shows only what partner is allowed to see.
 */

import { useTranslation } from 'react-i18next';
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { 
  User, 
  Shield, 
  ShieldCheck, 
  ShieldAlert, 
  ShieldOff,
  Eye,
  EyeOff,
  FileText,
  Activity,
  FlaskConical,
  ClipboardList,
  Lock,
  Calendar,
  Clock
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { MemberAccessSummary, MemberAccessLevel, ConsentStatus, DataCategory } from '@/schemas/memberAccessSchemas';
import { format } from 'date-fns';
interface MemberAccessCardProps {
  member: MemberAccessSummary;
  onRequestAccess?: (memberId: string) => void;
  onViewStory?: (memberId: string) => void;
  compact?: boolean;
}

const accessLevelConfig: Record<MemberAccessLevel, {
  icon: typeof Shield;
  color: string;
  bgColor: string;
}> = {
  full: { icon: ShieldCheck, color: 'text-success', bgColor: 'bg-success/10' },
  limited: { icon: Shield, color: 'text-warning', bgColor: 'bg-warning/10' },
  anonymized: { icon: ShieldAlert, color: 'text-muted-foreground', bgColor: 'bg-muted' },
  none: { icon: ShieldOff, color: 'text-destructive', bgColor: 'bg-destructive/10' },
};

const consentStatusConfig: Record<ConsentStatus, {
  color: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
}> = {
  granted: { color: 'text-success', variant: 'default' },
  pending: { color: 'text-warning', variant: 'secondary' },
  revoked: { color: 'text-destructive', variant: 'destructive' },
  expired: { color: 'text-muted-foreground', variant: 'outline' },
  never_asked: { color: 'text-muted-foreground', variant: 'outline' },
};

const categoryIcons: Record<DataCategory, typeof Activity> = {
  health_checkins: Activity,
  lab_results: FlaskConical,
  documents: FileText,
  assessments: ClipboardList,
  dosing_logs: Activity,
  study_data: ClipboardList,
};

export function MemberAccessCard({
  member,
  onRequestAccess,
  onViewStory,
  compact = false,
}: MemberAccessCardProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);

  const accessConfig = accessLevelConfig[member.access_level];
  const AccessIcon = accessConfig.icon;
  const consentConfig = consentStatusConfig[member.consent_status];

  const canViewDetails = member.access_level === 'full' || member.access_level === 'limited';
  const displayName = canViewDetails ? member.display_name : member.member_token;

  // Category permissions visualization
  const visibleCategories = member.permissions.filter(p => p.can_view);
  const hiddenCategories = member.permissions.filter(p => !p.can_view);

  const removeUnderscores = (value: string) => value.replace(/_/g, '');

  const snakeToPascalCase = (value: string) =>
    value
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors cursor-pointer"
           onClick={() => onViewStory?.(member.member_id)}>
        {/* Avatar placeholder with access indicator */}
        <div className={cn('relative p-2 rounded-full', accessConfig.bgColor)}>
          <User className={cn('h-5 w-5', accessConfig.color)} />
          <AccessIcon className={cn(
            'absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5',
            accessConfig.color
          )} />
        </div>

        {/* Name and status */}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">
            {displayName || t('storyloop.memberCard.anonymizedOnly')}
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {member.study_name && <span>{member.study_name}</span>}
            {member.has_recent_activity && (
              <span className="flex items-center gap-0.5 text-success">
                <Activity className="h-3 w-3" />
                {t('common.active')}
              </span>
            )}
          </div>
        </div>

        {/* Quick access badge */}
        <Badge variant={consentConfig.variant} className="text-xs">
          {t(`storyloop.memberCard.${member.consent_status === 'granted' ? 'consentGranted' : 
             member.consent_status === 'pending' ? 'consentPending' : 'consentRevoked'}`)}
        </Badge>
      </div>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className={cn('pb-3', accessConfig.bgColor)}>
        <div className="flex items-start justify-between">
          {/* Member identity */}
          <div className="flex items-center gap-3">
            <div className={cn('p-2.5 rounded-full bg-background shadow-sm')}>
              {canViewDetails ? (
                <User className="h-6 w-6 text-foreground" />
              ) : (
                <Lock className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div>
              <h3 className="font-semibold">
                {displayName || t('storyloop.memberCard.anonymizedOnly')}
              </h3>
              {member.study_name && (
                <p className="text-sm text-muted-foreground">{member.study_name}</p>
              )}
            </div>
          </div>

          {/* Access level badge */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge 
                variant="outline" 
                className={cn('gap-1', accessConfig.color, 'border-current')}
              >
                <AccessIcon className="h-3.5 w-3.5" />
                {t(`storyloop.memberCard.${member.access_level}Access`)}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-xs text-sm">
                {member.access_level === 'full' && t('storyloop.memberCard.fullAccessDesc')}
                {member.access_level === 'limited' && t('storyloop.memberCard.limitedAccessDesc')}
                {member.access_level === 'anonymized' && t('storyloop.memberCard.anonymizedDesc')}
                {member.access_level === 'none' && t('storyloop.memberCard.noAccessDesc')}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        {/* Data categories */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t('storyloop.memberCard.accessLevel')}
          </p>
          
          <div className="flex flex-wrap gap-1.5">
            {/* Visible categories */}
            {visibleCategories.map(perm => {
              const Icon = categoryIcons[perm.category];
              return (
                <Tooltip key={perm.category}>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" className="gap-1">
                      <Icon className="h-3 w-3" />
                      <Eye className="h-3 w-3 text-success" />
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t(`storyloop.memberCard.${removeUnderscores(perm.category)}`)}
                  </TooltipContent>
                </Tooltip>
              );
            })}
            
            {/* Hidden categories */}
            {hiddenCategories.map(perm => {
              const Icon = categoryIcons[perm.category];
              return (
                <Tooltip key={perm.category}>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="gap-1 opacity-50">
                      <Icon className="h-3 w-3" />
                      <EyeOff className="h-3 w-3" />
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t(`storyloop.memberCard.${removeUnderscores(perm.category)}`)} - {t('storyloop.memberCard.noAccess')}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>

        {/* Metadata (only if has access) */}
        {canViewDetails && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            {member.member_since && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                <span>{t('storyloop.memberCard.memberSince')}: {format(new Date(member.member_since), 'PP', { locale: dateLocale })}</span>
              </div>
            )}
            {member.last_activity_at && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>{t('storyloop.memberCard.lastActivity')}: {format(new Date(member.last_activity_at), 'PP', { locale: dateLocale })}</span>
              </div>
            )}
          </div>
        )}

        {/* Consent status and actions */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <div className="flex items-center gap-2">
            <Badge variant={consentConfig.variant}>
              {t(`storyloop.memberCard.consent${snakeToPascalCase(member.consent_status)}`)}
            </Badge>
            {member.consent_granted_at && (
              <span className="text-xs text-muted-foreground">
                {format(new Date(member.consent_granted_at), 'PP', { locale: dateLocale })}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {member.consent_status === 'never_asked' && onRequestAccess && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => onRequestAccess(member.member_id)}
              >
                {t('storyloop.memberCard.requestAccess')}
              </Button>
            )}
            {canViewDetails && onViewStory && (
              <Button 
                variant="default" 
                size="sm"
                onClick={() => onViewStory(member.member_id)}
              >
                {t('common.view')}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
