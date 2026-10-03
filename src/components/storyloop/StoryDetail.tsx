/**
 * StoryLoop Story Detail
 * 
 * Detail view with timeline entries, health panel and composer.
 */

import React, { useEffect, useState } from 'react';
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from 'react-i18next';
import {
  Star,
  MoreHorizontal,
  Archive,
  Trash2,
  Clock,
  MessageSquare,
  FileText,
  Activity,
  Bot,
  Pin,
  CheckCircle,
  Calendar,
  Languages,
  User,
  Heart,
  ChevronDown,
  ClipboardList,
  FlaskConical,
  GraduationCap,
  Pill,
  ShieldCheck,
  ShoppingBag,
  Microscope,
  Mail,
  Bookmark,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useStoryDetail, useToggleStoryStar, useUpdateStoryStatus } from '@/hooks/useStoryLoop';
import { useStoryBlockActions } from '@/hooks/useStoryBlockActions';
import { resolveSystemContent } from '@/hooks/useMyTimeline';
import { useUserTrackingMetrics, useUserConsentStatus } from '@/hooks/useUserTracking';
import { usePermissions } from '@/hooks/usePermissions';
import { useStoryLoopBookmarks } from '@/hooks/useStoryLoopBookmarks';
import { StoryComposer } from './StoryComposer';
import { StoryEntryBlockRenderer } from './blocks/StoryEntryBlockRenderer';
import { StoryTrackingSummary } from './StoryTrackingSummary';
import { UserTrackingPanel } from './UserTrackingPanel';
import { QuestionnaireResponseDetail } from './QuestionnaireResponseDetail';
import { ConsentDetail } from './ConsentDetail';
import { LabResultDetail } from './LabResultDetail';
import { StoryDeliveryPanel } from './StoryDeliveryPanel';
import { StoryParticipantsPanel } from './StoryParticipantsPanel';
import { StoryKnowledgeContext } from './StoryKnowledgeContext';
import { StoryKnowledgeUpload } from './StoryKnowledgeUpload';
import { StoryCanvasBuilderSkeleton } from './StoryCanvasBuilderSkeleton';
import { isBlockEntry } from './blocks/utils';
import type { StoryEntry } from '@/schemas/storyLoopSchemas';
import { format } from 'date-fns';
const LazyStoryCanvasBuilder = React.lazy(() =>
  import('./StoryCanvasBuilder').then((m) => ({ default: m.StoryCanvasBuilder })),
);

interface StoryDetailProps {
  storyId: string | null;
  onOpenAisha: () => void;
  canOpenAisha?: boolean;
  /**
   * When true, removes h-full flex constraints and uses
   * max-height for the timeline ScrollArea so the component
   * can live inside a standard page layout (not full-bleed).
   */
  standalone?: boolean;
}

interface StoryEntryComponentProps {
  entry: StoryEntry;
  storyId: string;
  isPartnerView: boolean;
  isThread?: boolean;
  isBookmarked: boolean;
  isHighlighted: boolean;
  onToggleBookmark: (entry: StoryEntry) => void;
  onMeetingAccept?: (entryId: string, time?: string) => void;
  onMeetingDecline?: (entryId: string) => void;
  onMeetingReschedule?: (entryId: string) => void;
  onQuestionnaireViewResults?: (responseId: string) => void;
  onQuestionnaireSendReminder?: (entryId: string) => void;
  onConsentView?: (consentId: string) => void;
  onConsentResend?: (entryId: string) => void;
  onApproveFlowGate?: (entryId: string, graphId: string) => void;
  onConfirmReprice?: (entryId: string) => void;
  onRejectReprice?: (entryId: string) => void;
  onLabViewResults?: (resultId: string) => void;
}

const entryTypeIcons: Record<string, React.ReactNode> = {
  note: <MessageSquare className="h-4 w-4" />,
  action: <CheckCircle className="h-4 w-4" />,
  system: <Activity className="h-4 w-4" />,
  health_event: <Activity className="h-4 w-4" />,
  request: <Clock className="h-4 w-4" />,
  message: <MessageSquare className="h-4 w-4" />,
  ai_recap: <Bot className="h-4 w-4" />,
  document: <FileText className="h-4 w-4" />,
  appointment: <Calendar className="h-4 w-4" />,
  translation: <Languages className="h-4 w-4" />,
  meeting_request: <Calendar className="h-4 w-4" />,
  questionnaire_request: <ClipboardList className="h-4 w-4" />,
  consent_request: <ShieldCheck className="h-4 w-4" />,
  lab_order: <FlaskConical className="h-4 w-4" />,
  distribution_adjustment: <Pill className="h-4 w-4" />,
  blood_matrix_analysis: <Microscope className="h-4 w-4" />,
  // System entries from member actions
  system_check_in: <Activity className="h-4 w-4" />,
  system_dosing: <Pill className="h-4 w-4" />,
  system_registration: <GraduationCap className="h-4 w-4" />,
  system_lab_result: <FlaskConical className="h-4 w-4" />,
  system_order: <ShoppingBag className="h-4 w-4" />,
  system_questionnaire: <ClipboardList className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
};

const entryTypeColors: Record<string, string> = {
  note: 'border-l-primary',
  action: 'border-l-success',
  system: 'border-l-muted-foreground',
  health_event: 'border-l-warning',
  request: 'border-l-info',
  message: 'border-l-primary',
  ai_recap: 'border-l-secondary',
  document: 'border-l-accent',
  appointment: 'border-l-info',
  translation: 'border-l-muted-foreground',
  meeting_request: 'border-l-info',
  questionnaire_request: 'border-l-secondary',
  consent_request: 'border-l-success',
  lab_order: 'border-l-accent',
  distribution_adjustment: 'border-l-warning',
  blood_matrix_analysis: 'border-l-primary',
  // System entries from member actions
  system_check_in: 'border-l-success',
  system_dosing: 'border-l-secondary',
  system_registration: 'border-l-info',
  system_lab_result: 'border-l-accent',
  system_order: 'border-l-warning',
  system_questionnaire: 'border-l-primary',
  email: 'border-l-info',
};

function StoryEntryComponent({
  entry,
  storyId,
  isPartnerView,
  isThread = false,
  isBookmarked,
  isHighlighted,
  onToggleBookmark,
  onMeetingAccept,
  onMeetingDecline,
  onMeetingReschedule,
  onQuestionnaireViewResults,
  onQuestionnaireSendReminder,
  onConsentView,
  onConsentResend,
  onApproveFlowGate,
  onConfirmReprice,
  onRejectReprice,
  onLabViewResults,
}: StoryEntryComponentProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);

  const formattedDate = format(new Date(entry.created_at), 'PPp', { locale: dateLocale });

  return (
    <div className={cn(
      'relative border-l-2 py-3 pl-4 sm:py-3.5 sm:pl-5',
      entryTypeColors[entry.entry_type] || 'border-l-border',
      isThread && 'ml-6',
      entry.is_pinned && 'bg-muted/30',
      isHighlighted && 'rounded-r-md bg-primary/5 ring-1 ring-primary/30'
    )}
    id={`story-entry-${entry.id}`}>
      {/* Pin indicator */}
      {entry.is_pinned && (
        <Pin className="absolute -left-2.5 top-3 h-4 w-4 text-primary bg-background rounded-full" />
      )}

      {/* Header */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          {entryTypeIcons[entry.entry_type]}
          {t(`storyloop.entry.${entry.entry_type}`)}
        </span>
        {entry.is_internal && (
          <Badge variant="outline" className="h-4 text-[10px]">
            {t('storyloop.internal')}
          </Badge>
        )}
        <span className="ml-auto flex items-center gap-1">
          <span>{formattedDate}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'h-6 w-6',
              isBookmarked && 'text-primary'
            )}
            onClick={() => onToggleBookmark(entry)}
            aria-label={t(isBookmarked ? 'storyloop.bookmarks.remove' : 'storyloop.bookmarks.add')}
          >
            <Bookmark className={cn('h-3.5 w-3.5', isBookmarked && 'fill-current')} />
          </Button>
        </span>
      </div>

      {/* Author */}
      {entry.created_by_name && (
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <User className="h-3 w-3" />
          {entry.created_by_name}
        </div>
      )}

      {/* Content - either block or text */}
      {isBlockEntry(entry.entry_type) ? (
        <div className="mt-2">
          <StoryEntryBlockRenderer
            entry={entry}
            storyId={storyId}
            isPartnerView={isPartnerView}
            onMeetingAccept={onMeetingAccept}
            onMeetingDecline={onMeetingDecline}
            onMeetingReschedule={onMeetingReschedule}
            onQuestionnaireViewResults={onQuestionnaireViewResults}
            onQuestionnaireSendReminder={onQuestionnaireSendReminder}
            onConsentView={onConsentView}
            onConsentResend={onConsentResend}
            onApproveFlowGate={onApproveFlowGate}
            onConfirmReprice={onConfirmReprice}
            onRejectReprice={onRejectReprice}
            onLabViewResults={onLabViewResults}
          />
        </div>
      ) : (
        <>
          {entry.content && (
            <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed lg:text-[15px]">
              {resolveSystemContent(
                entry.content,
                t,
                entry.metadata as Record<string, unknown> | null,
              )}
            </div>
          )}

          {/* Document preview */}
          {entry.document_preview && (
            <div className="mt-2 flex items-center gap-2 rounded-md bg-muted/50 p-2 sm:p-2.5">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm truncate">{entry.document_preview.file_name}</span>
              <Badge variant="outline" className="ml-auto text-xs">
                {entry.document_preview.category}
              </Badge>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StoryDetailSkeleton() {
  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="border-b border-border p-3 sm:p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
      </div>
      <div className="flex-1 p-4 space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="h-full flex items-center justify-center text-muted-foreground">
      <div className="text-center">
        <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-20" />
        <p className="text-sm">{t('storyloop.selectStory')}</p>
      </div>
    </div>
  );
}

/**
 * Renders the StoryLoop detail view for a selected story.
 */
export function StoryDetail({
  storyId,
  onOpenAisha,
  canOpenAisha = true,
  standalone = false,
}: StoryDetailProps) {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const { data: story, isLoading } = useStoryDetail(storyId);
  const toggleStar = useToggleStoryStar();
  const updateStatus = useUpdateStoryStatus();
  const { hasPermission } = usePermissions();
  const { toggleBookmark, isBookmarked } = useStoryLoopBookmarks();
  const blockActions = useStoryBlockActions(storyId);
  const isPartnerView =
    hasPermission('view_assigned_members') || hasPermission('view_partner_dashboard');
  const dateLocale = getDateFnsLocale(i18n.language);
  const [trackingPanelOpen, setTrackingPanelOpen] = useState(false);
  const [highlightedEntryId, setHighlightedEntryId] = useState<string | null>(null);
  const targetPostId = searchParams.get('post');
  // Nový stav pro fullscreen režim (skrytá hlavička)
  const [isHeaderHidden, setIsHeaderHidden] = useState(false);

  // Fetch health metrics for summary (only if we have a user)
  const userId = story?.user_id ?? null;
  const { data: consentStatus } = useUserConsentStatus(userId);
  const hasConsent = !!userId && (hasPermission('view_sensitive_data') || consentStatus === 'granted');
  const { data: metrics } = useUserTrackingMetrics(hasConsent ? userId : null);

  useEffect(() => {
    if (!targetPostId || !story) return;
    const hasTargetEntry = story.entries.some((entry) => entry.id === targetPostId);
    if (!hasTargetEntry) return;

    const timer = window.setTimeout(() => {
      const element = document.getElementById(`story-entry-${targetPostId}`);
      if (!element) return;
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setHighlightedEntryId(targetPostId);
    }, 80);

    return () => {
      window.clearTimeout(timer);
    };
  }, [story, targetPostId]);

  useEffect(() => {
    if (!highlightedEntryId) return;
    const timer = window.setTimeout(() => {
      setHighlightedEntryId(null);
    }, 3500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [highlightedEntryId]);

  if (!storyId) {
    return <EmptyState />;
  }

  if (isLoading) {
    return <StoryDetailSkeleton />;
  }

  if (!story) {
    return <EmptyState />;
  }

  const handleArchive = () => {
    updateStatus.mutate({ story_id: story.id, status: 'archived' });
  };

  const handleTrash = () => {
    updateStatus.mutate({ story_id: story.id, status: 'trash' });
  };

  const handleStatusChange = (status: string) => {
    updateStatus.mutate({ story_id: story.id, status });
  };

  // Group entries by parent (for threading)
  const rootEntries = story.entries.filter(e => !e.parent_id);
  const childrenMap = new Map<string, StoryEntry[]>();
  story.entries.filter(e => e.parent_id).forEach(e => {
    const children = childrenMap.get(e.parent_id!) || [];
    children.push(e);
    childrenMap.set(e.parent_id!, children);
  });

  const userName = story.user_display_name || t('storyloop.unknownUser');
  const statusKey = story.status === 'in_progress' ? 'inProgress' : story.status;
  const statusLabel = t(`storyloop.statuses.${statusKey}`);

  const handleToggleBookmark = (entry: StoryEntry) => {
    toggleBookmark({
      threadType: 'story',
      threadId: story.id,
      entryId: entry.id,
      threadTitle: story.title,
      entryPreview: entry.content,
    });
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header (skrytelný) */}
      {!isHeaderHidden && (
        <div className="border-b border-border p-3 sm:p-4 lg:px-5 relative group">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="flex-1 min-w-0">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('storyloop.threadModes.stories')}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="max-w-full truncate text-base font-semibold sm:text-lg lg:text-xl">
                  {userName}
                </h2>
                <Badge variant="outline">{statusLabel}</Badge>
                {story.study_name && (
                  <Badge variant="secondary">{story.study_name}</Badge>
                )}
              </div>
              <p className="mt-0.5 truncate text-sm text-muted-foreground lg:text-[15px]">
                {story.title}
              </p>
            </div>

            <div className="flex items-center gap-1 self-end sm:self-auto lg:gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => toggleStar.mutate(story.id)}
                className={cn(story.is_starred && 'text-warning')}
              >
                <Star className={cn('h-4 w-4', story.is_starred && 'fill-current')} />
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={onOpenAisha}
                disabled={!canOpenAisha}
                className="gap-1 px-2 sm:px-3"
              >
                <Bot className="h-4 w-4" />
                <span className="hidden sm:inline">{t('storyloop.aisha.name')}</span>
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleStatusChange('inbox')}>
                    {t('storyloop.moveTo')} {t('storyloop.inbox')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleStatusChange('in_progress')}>
                    {t('storyloop.moveTo')} {t('storyloop.inProgress')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleStatusChange('scheduled')}>
                    {t('storyloop.moveTo')} {t('storyloop.scheduled')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleArchive}>
                    <Archive className="h-4 w-4 mr-2" />
                    {t('storyloop.archive')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleTrash} className="text-destructive">
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t('storyloop.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {/* Tlačítko pro skrytí hlavičky (fullscreen) */}
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('storyloop.hideHeader')}
                onClick={() => setIsHeaderHidden(true)}
                className="ml-1 opacity-60 group-hover:opacity-100"
              >
                <ChevronDown className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* Tracking Summary in header */}
          {hasConsent && metrics && (
            <StoryTrackingSummary
              metrics={metrics}
              hasConsent={hasConsent}
              className="mt-3"
            />
          )}

          {/* Labels */}
          {story.labels.length > 0 && (
            <div className="flex items-center gap-1.5 mt-3">
              {story.labels.map((label) => (
                <Badge key={label.label} variant="outline">
                  {label.label}
                </Badge>
              ))}
            </div>
          )}

          {/* Reminders */}
          {story.reminders.length > 0 && (
            <div className="mt-3 space-y-1 text-xs">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>{t('storyloop.reminders.upcoming')}</span>
              </div>
              <div className="space-y-1 pl-5">
                {story.reminders.map((reminder) => (
                  <div key={reminder.id} className="break-words text-muted-foreground">
                    {format(new Date(reminder.remind_at), 'PPp', { locale: dateLocale })}
                    {reminder.message && `: ${reminder.message}`}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Minimalistický proužek pro návrat hlavičky, pokud je skrytá */}
      {isHeaderHidden && (
        <div className="border-b border-border bg-muted/30 flex items-center justify-center h-8 relative">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('storyloop.showHeader')}
            onClick={() => setIsHeaderHidden(false)}
            className="mx-auto"
          >
            <ChevronDown className="h-5 w-5 rotate-180" />
          </Button>
        </div>
      )}

      {/* Collapsible Tracking Panel */}
      {userId && (
        <Collapsible open={trackingPanelOpen} onOpenChange={setTrackingPanelOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="h-auto w-full justify-between rounded-none border-b border-border px-3 py-2 sm:px-4"
            >
              <span className="flex items-center gap-2 text-sm">
                <Heart className="h-4 w-4" />
                {t('storyloop.trackingPanel.title')}
              </span>
              <ChevronDown className={cn(
                "h-4 w-4 transition-transform",
                trackingPanelOpen && "rotate-180"
              )} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-b border-border bg-muted/20 p-3 sm:p-4">
              <UserTrackingPanel
                userId={userId}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Delivery Context Panel — partner/staff only */}
      {isPartnerView && story && (
        <StoryDeliveryPanel storyId={story.id} />
      )}

      {/* Visual Canvas Builder — partner/staff only */}
      {isPartnerView && story && (
        <React.Suspense fallback={<StoryCanvasBuilderSkeleton />}>
          <LazyStoryCanvasBuilder
            canvasData={null}
            partnerId={story.partner_id}
            storyId={story.id}
          />
        </React.Suspense>
      )}

      {/* Participants Panel — partner/staff only */}
      {isPartnerView && story && (
        <StoryParticipantsPanel storyId={story.id} />
      )}

      {/* Knowledge Context — relevant expert rules */}
      {isPartnerView && story && (
        <StoryKnowledgeContext storyId={story.id} />
      )}

      {/* Per-story Knowledge Base Upload — Insight integrace (Ragnarok) */}
      {isPartnerView && story && (
        <div className="px-4 pb-3">
          <StoryKnowledgeUpload storyId={story.id} />
        </div>
      )}

      {/* Timeline */}
      <ScrollArea className="flex-1 min-h-0 p-3 sm:p-4 lg:px-5">
        <div className="space-y-1.5">
          {rootEntries.map((entry) => (
            <React.Fragment key={entry.id}>
              <StoryEntryComponent
                entry={entry}
                storyId={story.id}
                isPartnerView={isPartnerView}
                isBookmarked={isBookmarked('story', story.id, entry.id)}
                isHighlighted={highlightedEntryId === entry.id}
                onToggleBookmark={handleToggleBookmark}
                onMeetingAccept={blockActions.onMeetingAccept}
                onMeetingDecline={blockActions.onMeetingDecline}
                onMeetingReschedule={blockActions.onMeetingReschedule}
                onQuestionnaireViewResults={blockActions.onQuestionnaireViewResults}
                onQuestionnaireSendReminder={blockActions.onQuestionnaireSendReminder}
                onConsentView={blockActions.onConsentView}
                onConsentResend={blockActions.onConsentResend}
                onApproveFlowGate={blockActions.onApproveFlowGate}
                onConfirmReprice={blockActions.onConfirmReprice}
                onRejectReprice={blockActions.onRejectReprice}
                onLabViewResults={blockActions.onLabViewResults}
              />
              {/* Thread children */}
              {childrenMap.get(entry.id)?.map((child) => (
                <StoryEntryComponent
                  key={child.id}
                  entry={child}
                  storyId={story.id}
                  isPartnerView={isPartnerView}
                  isThread
                  isBookmarked={isBookmarked('story', story.id, child.id)}
                  isHighlighted={highlightedEntryId === child.id}
                  onToggleBookmark={handleToggleBookmark}
                  onMeetingAccept={blockActions.onMeetingAccept}
                  onMeetingDecline={blockActions.onMeetingDecline}
                  onMeetingReschedule={blockActions.onMeetingReschedule}
                  onQuestionnaireViewResults={blockActions.onQuestionnaireViewResults}
                  onQuestionnaireSendReminder={blockActions.onQuestionnaireSendReminder}
                  onConsentView={blockActions.onConsentView}
                  onConsentResend={blockActions.onConsentResend}
                  onApproveFlowGate={blockActions.onApproveFlowGate}
                  onConfirmReprice={blockActions.onConfirmReprice}
                  onRejectReprice={blockActions.onRejectReprice}
                  onLabViewResults={blockActions.onLabViewResults}
                />
              ))}
            </React.Fragment>
          ))}
        </div>
      </ScrollArea>

      {/* Composer */}
      <div className="border-t border-border">
        <StoryComposer
          storyId={story.id}
          studyId={story.study_id}
          userId={story.user_id}
        />
      </div>

      {/* Questionnaire response detail modal */}
      <QuestionnaireResponseDetail
        responseId={blockActions.responseDetailId}
        open={blockActions.responseDetailOpen}
        onOpenChange={blockActions.setResponseDetailOpen}
      />

      {/* Consent detail modal */}
      <ConsentDetail
        consentId={blockActions.consentDetailId}
        open={blockActions.consentDetailOpen}
        onOpenChange={blockActions.setConsentDetailOpen}
      />

      {/* Lab result detail modal */}
      <LabResultDetail
        labResultId={blockActions.labDetailId}
        open={blockActions.labDetailOpen}
        onOpenChange={blockActions.setLabDetailOpen}
      />
    </div>
  );
}
