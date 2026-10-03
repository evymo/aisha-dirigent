/**
 * StoryLoop Composer
 * 
 * Add new entries to a story, including structured blocks.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Send,
  Paperclip,
  Lock,
  ChevronDown,
  Plus,
  Calendar,
  ClipboardList,
  FileSignature,
  FlaskConical,
  Pill,
  Heart,
  Microscope,
  Mail,
  Upload,
  Globe,
  Wand2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateStoryEntry, useStoryAttachableDocuments } from '@/hooks/useStoryLoop';
import { usePermissions } from '@/hooks/usePermissions';
import {
  buildMemberStoryEntryLink,
  buildNotificationContent,
  type NotificationType,
  useCreateStoryLoopNotification,
} from '@/hooks/useStoryLoopNotifications';
import { safeError } from '@/lib/security/safeLogger';
import { toast } from 'sonner';
import { MeetingBlockForm } from './composer/MeetingBlockForm';
import { QuestionnaireBlockForm } from './composer/QuestionnaireBlockForm';
import { ConsentBlockForm } from './composer/ConsentBlockForm';
import { LabOrderBlockForm } from './composer/LabOrderBlockForm';
import { DistributionAdjustmentBlockForm } from './composer/DistributionAdjustmentBlockForm';
import { BloodMatrixAnalysisBlockForm } from './composer/BloodMatrixAnalysisBlockForm';
import { EmailBlockForm } from './composer/EmailBlockForm';
import { ProductLogBlockForm } from './composer/ProductLogBlockForm';
import { TrackingLogBlockForm } from './composer/TrackingLogBlockForm';
import { WebUploadBlockForm } from './composer/WebUploadBlockForm';
import { WebScrapeBlockForm } from './composer/WebScrapeBlockForm';
import { WebRedesignBlockForm } from './composer/WebRedesignBlockForm';

interface StoryComposerProps {
  storyId: string;
  studyId?: string | null;
  userId?: string | null;
  parentId?: string;
  onSuccess?: () => void;
  /** When true, restricts entry/block types to member-allowed subset */
  memberMode?: boolean;
}

type EntryType = 'note' | 'action' | 'message';
type MemberBlockType = 'product_log' | 'health_log';
type PartnerBlockType =
  | 'meeting_request'
  | 'questionnaire_request'
  | 'consent_request'
  | 'lab_order'
  | 'distribution_adjustment'
  | 'blood_matrix_analysis'
  | 'email'
  | 'web_artifact_upload'
  | 'web_artifact_scrape'
  | 'web_artifact_redesign_request';
type BlockType = PartnerBlockType | MemberBlockType;

const entryTypeOptions: { value: EntryType; label: string }[] = [
  { value: 'note', label: 'storyloop.entry.note' },
  { value: 'action', label: 'storyloop.entry.action' },
  { value: 'message', label: 'storyloop.entry.message' },
];

const blockTypeOptions: { value: BlockType; label: string; icon: typeof Calendar; description: string }[] = [
  {
    value: 'meeting_request',
    label: 'storyloop.blocks.meetingRequest',
    icon: Calendar,
    description: 'storyloop.blocks.meetingRequestDesc'
  },
  {
    value: 'questionnaire_request',
    label: 'storyloop.blocks.questionnaireRequest',
    icon: ClipboardList,
    description: 'storyloop.blocks.questionnaireRequestDesc'
  },
  {
    value: 'consent_request',
    label: 'storyloop.blocks.consentRequest',
    icon: FileSignature,
    description: 'storyloop.blocks.consentRequestDesc'
  },
  {
    value: 'lab_order',
    label: 'storyloop.blocks.labOrder',
    icon: FlaskConical,
    description: 'storyloop.blocks.labOrderDesc'
  },
  {
    value: 'distribution_adjustment',
    label: 'storyloop.blocks.distributionAdjustment',
    icon: Pill,
    description: 'storyloop.blocks.distributionAdjustmentDesc'
  },
  {
    value: 'blood_matrix_analysis',
    label: 'storyloop.blocks.bloodMatrixAnalysis',
    icon: Microscope,
    description: 'storyloop.blocks.bloodMatrixAnalysisDesc'
  },
  {
    value: 'email',
    label: 'storyloop.blocks.email',
    icon: Mail,
    description: 'storyloop.blocks.emailDesc'
  },
  {
    value: 'web_artifact_upload',
    label: 'storyloop.blocks.webUpload',
    icon: Upload,
    description: 'storyloop.blocks.webUploadDesc'
  },
  {
    value: 'web_artifact_scrape',
    label: 'storyloop.blocks.webScrape',
    icon: Globe,
    description: 'storyloop.blocks.webScrapeDesc'
  },
  {
    value: 'web_artifact_redesign_request',
    label: 'storyloop.blocks.webRedesign',
    icon: Wand2,
    description: 'storyloop.blocks.webRedesignDesc'
  },
];

/** Block types available to members in memberMode */
const memberBlockTypeOptions: { value: MemberBlockType; label: string; icon: typeof Calendar; description: string }[] = [
  {
    value: 'product_log',
    label: 'storyloop.blocks.productLog',
    icon: Pill,
    description: 'storyloop.blocks.productLogDesc'
  },
  {
    value: 'health_log',
    label: 'storyloop.blocks.healthLog',
    icon: Heart,
    description: 'storyloop.blocks.trackingLogDesc'
  },
];

/** Entry types available to members (no 'action' — that's partner-only) */
const memberEntryTypeOptions: { value: EntryType; label: string }[] = [
  { value: 'note', label: 'storyloop.entry.note' },
  { value: 'message', label: 'storyloop.entry.message' },
];

export function StoryComposer({ storyId, studyId, userId, parentId, onSuccess, memberMode }: StoryComposerProps) {
  const { t } = useTranslation();
  const { hasPermission, hasAnyPermission } = usePermissions();
  const canUseInternalNotes =
    !memberMode && (hasPermission('view_assigned_members') || hasPermission('view_partner_dashboard'));
  const canCreateMemberNotifications =
    hasAnyPermission(
      'view_assigned_members',
      'view_partner_dashboard',
      'view_admin_dashboard',
      'view_staff_dashboard'
    );
  const [content, setContent] = useState('');
  const [entryType, setEntryType] = useState<EntryType>('note');
  const [isInternal, setIsInternal] = useState(false);
  const [activeBlockForm, setActiveBlockForm] = useState<BlockType | null>(null);
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>('');
  const createEntry = useCreateStoryEntry();
  const createNotification = useCreateStoryLoopNotification();
  const { data: attachableDocuments = [] } = useStoryAttachableDocuments(storyId);

  const mapEntryTypeToNotificationType = (
    value: EntryType | BlockType | 'document'
  ): NotificationType => {
    switch (value) {
      case 'meeting_request':
      case 'questionnaire_request':
      case 'consent_request':
      case 'lab_order':
      case 'distribution_adjustment':
        return value;
      default:
        return 'message';
    }
  };

  const maybeNotifyMember = async ({
    createdEntryId,
    createdEntryType,
    createdContent,
    createdMetadata,
    internalOnly,
  }: {
    createdEntryId: string;
    createdEntryType: EntryType | BlockType | 'document';
    createdContent?: string;
    createdMetadata?: Record<string, unknown>;
    internalOnly?: boolean;
  }) => {
    if (!userId || !canCreateMemberNotifications || internalOnly) {
      return;
    }

    const notificationType = mapEntryTypeToNotificationType(createdEntryType);
    const metadata = {
      ...(createdMetadata ?? {}),
      preview: (createdContent ?? '').trim(),
      content: (createdContent ?? '').trim(),
    };
    const notification = buildNotificationContent(notificationType, metadata, t);

    try {
      await createNotification.mutateAsync({
        userId: userId,
        type: notificationType,
        title: notification.title,
        message: notification.message,
        link: buildMemberStoryEntryLink(storyId, createdEntryId),
      });
    } catch (error) {
      // Do not block entry creation if notification delivery fails.
      safeError('StoryComposer.notification', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!content.trim()) return;

    try {
      const trimmedContent = content.trim();
      const createdEntryId = await createEntry.mutateAsync({
        story_id: storyId,
        entry_type: entryType,
        content: trimmedContent,
        is_internal: canUseInternalNotes ? isInternal : false,
        parent_id: parentId,
      });

      await maybeNotifyMember({
        createdEntryId,
        createdEntryType: entryType,
        createdContent: trimmedContent,
        internalOnly: canUseInternalNotes ? isInternal : false,
      });

      setContent('');
      setIsInternal(false);
      onSuccess?.();
      toast.success(t('storyloop.entryAdded'));
    } catch {
      toast.error(t('errors.genericError'));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit(e);
    }
  };

  const handleBlockSubmit = async (blockType: Exclude<BlockType, 'web_artifact_redesign_request'>, metadata: Record<string, unknown>, contentText?: string) => {
    try {
      const createdEntryId = await createEntry.mutateAsync({
        story_id: storyId,
        entry_type: blockType,
        content: contentText,
        metadata: { type: blockType, ...metadata },
        is_internal: false,
        parent_id: parentId,
      });

      await maybeNotifyMember({
        createdEntryId,
        createdEntryType: blockType,
        createdContent: contentText,
        createdMetadata: metadata,
      });

      setActiveBlockForm(null);
      onSuccess?.();
      toast.success(t('storyloop.blockAdded'));
    } catch {
      toast.error(t('errors.genericError'));
    }
  };

  const handleOpenAttachDialog = () => {
    setSelectedDocumentId(attachableDocuments[0]?.id ?? '');
    setAttachDialogOpen(true);
  };

  const handleAttachDocument = async () => {
    if (!selectedDocumentId) return;

    try {
      const trimmedContent = content.trim();
      const createdEntryId = await createEntry.mutateAsync({
        story_id: storyId,
        entry_type: 'document',
        content: trimmedContent || undefined,
        document_id: selectedDocumentId,
        is_internal: false,
        parent_id: parentId,
      });

      await maybeNotifyMember({
        createdEntryId,
        createdEntryType: 'document',
        createdContent: trimmedContent,
      });

      setContent('');
      setAttachDialogOpen(false);
      onSuccess?.();
      toast.success(t('storyloop.entryAdded'));
    } catch {
      toast.error(t('errors.genericError'));
    }
  };

  const renderBlockForm = () => {
    switch (activeBlockForm) {
      case 'meeting_request':
        return (
          <MeetingBlockForm
            onSubmit={(metadata, content) => handleBlockSubmit('meeting_request', metadata, content)}
            onCancel={() => setActiveBlockForm(null)}
            isPending={createEntry.isPending}
          />
        );
      case 'questionnaire_request':
        return (
          <QuestionnaireBlockForm
            onSubmit={(metadata, content) => handleBlockSubmit('questionnaire_request', metadata, content)}
            onCancel={() => setActiveBlockForm(null)}
            isPending={createEntry.isPending}
            studyId={studyId}
          />
        );
      case 'consent_request':
        return (
          <ConsentBlockForm
            onSubmit={(metadata, content) => handleBlockSubmit('consent_request', metadata, content)}
            onCancel={() => setActiveBlockForm(null)}
            isPending={createEntry.isPending}
          />
        );
      case 'lab_order':
        return (
          <LabOrderBlockForm
            onSubmit={(metadata, content) => handleBlockSubmit('lab_order', metadata, content)}
            onCancel={() => setActiveBlockForm(null)}
            isPending={createEntry.isPending}
          />
        );
      case 'distribution_adjustment':
        return (
          <DistributionAdjustmentBlockForm
            onSubmit={(metadata, content) => handleBlockSubmit('distribution_adjustment', metadata, content)}
            onCancel={() => setActiveBlockForm(null)}
            isPending={createEntry.isPending}
          />
        );
      case 'blood_matrix_analysis':
        return (
          <BloodMatrixAnalysisBlockForm
            onSubmit={(metadata, content) =>
              handleBlockSubmit('blood_matrix_analysis', metadata, content)
            }
            onCancel={() => setActiveBlockForm(null)}
            isPending={createEntry.isPending}
          />
        );
      case 'email':
        return (
          <EmailBlockForm
            onSubmit={(metadata, content) =>
              handleBlockSubmit('email', metadata, content)
            }
            onCancel={() => setActiveBlockForm(null)}
            isPending={createEntry.isPending}
          />
        );
      // ── Member block forms ──
      // These manage their own mutations (diary hooks → DB triggers create timeline entries).
      // onSubmit() is a no-arg callback that just closes the dialog.
      case 'product_log':
        return (
          <ProductLogBlockForm
            onSubmit={() => { setActiveBlockForm(null); onSuccess?.(); }}
            onCancel={() => setActiveBlockForm(null)}
          />
        );
      case 'health_log':
        return (
          <TrackingLogBlockForm
            onSubmit={() => { setActiveBlockForm(null); onSuccess?.(); }}
            onCancel={() => setActiveBlockForm(null)}
          />
        );
      // ── Web artifact block forms ──
      // These manage their own mutations (web pipeline hooks → RPCs create
      // story_entries server-side as part of job lifecycle). onSuccess() just
      // closes the dialog and lets the existing useStoryEntries query refresh.
      case 'web_artifact_upload':
        return (
          <WebUploadBlockForm
            storyId={storyId}
            onSuccess={() => { setActiveBlockForm(null); onSuccess?.(); }}
            onCancel={() => setActiveBlockForm(null)}
          />
        );
      case 'web_artifact_scrape':
        return (
          <WebScrapeBlockForm
            storyId={storyId}
            onSuccess={() => { setActiveBlockForm(null); onSuccess?.(); }}
            onCancel={() => setActiveBlockForm(null)}
          />
        );
      case 'web_artifact_redesign_request':
        return (
          <WebRedesignBlockForm
            storyId={storyId}
            onSuccess={() => { setActiveBlockForm(null); onSuccess?.(); }}
            onCancel={() => setActiveBlockForm(null)}
          />
        );
      default:
        return null;
    }
  };

  const activeEntryTypeOptions = memberMode ? memberEntryTypeOptions : entryTypeOptions;
  const selectedEntryTypeOption =
    activeEntryTypeOptions.find((option) => option.value === entryType) ?? activeEntryTypeOptions[0];

  return (
    <>
      <form onSubmit={handleSubmit} className="p-3 sm:p-4">
        <div className="space-y-2">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t(memberMode ? 'storyloop.memberComposerPlaceholder' : 'storyloop.composerPlaceholder')}
            className="min-h-[80px] resize-none lg:min-h-[92px]"
          />

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {/* Entry type selector */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1 lg:h-9">
                    {t(selectedEntryTypeOption.label)}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {activeEntryTypeOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={() => setEntryType(option.value)}
                    >
                      {t(option.label)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Internal checkbox */}
              {canUseInternalNotes && (
                <div className="flex items-center gap-1.5">
                  <Checkbox
                    id="internal"
                    checked={isInternal}
                    onCheckedChange={(checked) => setIsInternal(checked === true)}
                  />
                  <Label htmlFor="internal" className="text-xs text-muted-foreground flex items-center gap-1 cursor-pointer">
                    <Lock className="h-3 w-3" />
                    {t('storyloop.internalNote')}
                  </Label>
                </div>
              )}

              {/* Add block dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="gap-1 lg:h-9">
                    <Plus className="h-3.5 w-3.5" />
                    {t('storyloop.addBlock')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel>{t('storyloop.insertBlock')}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {(memberMode ? memberBlockTypeOptions : blockTypeOptions).map((option) => {
                    const Icon = option.icon;
                    return (
                      <DropdownMenuItem
                        key={option.value}
                        onClick={() => setActiveBlockForm(option.value)}
                        className="flex items-start gap-2 py-2"
                      >
                        <Icon className="h-4 w-4 mt-0.5 text-muted-foreground" />
                        <div className="flex-1">
                          <p className="font-medium text-sm">
                            {t(option.label)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t(option.description)}
                          </p>
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button type="button" variant="ghost" size="sm" className="gap-1 lg:h-9" onClick={handleOpenAttachDialog}>
                <Paperclip className="h-4 w-4" />
              </Button>
            </div>

            <Button
              type="submit"
              size="sm"
              disabled={!content.trim() || createEntry.isPending}
              className="w-full gap-1 sm:w-auto lg:h-9"
            >
              <Send className="h-4 w-4" />
              {t('common.send')}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            {t('storyloop.composerHint')}
          </p>
        </div>
      </form>

      {/* Block form dialog */}
      <Dialog open={!!activeBlockForm} onOpenChange={(open) => !open && setActiveBlockForm(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {activeBlockForm && t(
                [...blockTypeOptions, ...memberBlockTypeOptions].find(o => o.value === activeBlockForm)?.label || '',
                activeBlockForm
              )}
            </DialogTitle>
          </DialogHeader>
          {renderBlockForm()}
        </DialogContent>
      </Dialog>

      <Dialog open={attachDialogOpen} onOpenChange={setAttachDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('storyloop.entry.document')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Label>{t('common.select')}</Label>
            <Select value={selectedDocumentId} onValueChange={setSelectedDocumentId}>
              <SelectTrigger>
                <SelectValue placeholder={t('common.select')} />
              </SelectTrigger>
              <SelectContent>
                {attachableDocuments.map((document) => (
                  <SelectItem key={document.id} value={document.id}>
                    {document.title || document.file_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {attachableDocuments.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('common.noData')}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAttachDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleAttachDocument}
              disabled={!selectedDocumentId || createEntry.isPending}
            >
              {t('common.send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
