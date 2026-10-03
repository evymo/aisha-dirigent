/**
 * StoryParticipantsPanel — collapsible panel showing story participants
 * with ability to add/remove collaborators.
 *
 * Integrated into StoryDetail as a collapsible section.
 *
 * @module components/storyloop/StoryParticipantsPanel
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  Users,
  Plus,
  X,
  UserPlus,
  LogOut,
  Shield,
  Crown,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useStoryParticipants, useRemoveStoryParticipant } from "@/hooks/useStoryParticipants";
import { useSession } from "@/hooks/useSession";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { AddParticipantDialog } from "./AddParticipantDialog";
import type { StoryParticipant } from "@/schemas/storyLoopSchemas";

interface StoryParticipantsPanelProps {
  storyId: string;
  defaultOpen?: boolean;
}

const ROLE_ICONS: Record<string, React.ReactNode> = {
  partner: <Crown className="h-3 w-3" />,
  member: <Shield className="h-3 w-3" />,
  guild_expert: <Users className="h-3 w-3" />,
};

/**
 * Renders participant list for a story with add/remove controls.
 *
 * @example
 * <StoryParticipantsPanel storyId={storyId} />
 */
export function StoryParticipantsPanel({
  storyId,
  defaultOpen = false,
}: StoryParticipantsPanelProps) {
  const { t } = useTranslation();
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const { toast } = useToast();
  const { data: participants, isLoading } = useStoryParticipants(storyId);
  const removeParticipant = useRemoveStoryParticipant();

  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<StoryParticipant | null>(null);

  const currentUserId = user?.id;
  const isOwner = participants?.some(
    (p) => p.user_id === currentUserId && p.role === "partner"
  );
  const canManage = isOwner || hasPermission("manage_story_participants");

  const handleRemove = async (target: StoryParticipant) => {
    const isSelf = target.user_id === currentUserId;
    try {
      await removeParticipant.mutateAsync({
        story_id: storyId,
        target_user_id: target.user_id,
      });
      toast({
        title: t(isSelf ? "storyloop.participants.leftStory" : "storyloop.participants.participantRemoved"),
        description: t(isSelf ? "storyloop.participants.leftStoryDescription" : "storyloop.participants.participantRemovedDescription"),
      });
    } catch {
      toast({
        title: t("storyloop.participants.error"),
        description: t("storyloop.participants.removeError"),
        variant: "destructive",
      });
    } finally {
      setRemoveTarget(null);
    }
  };

  const participantCount = participants?.length ?? 0;

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <button className="w-full px-4 py-2.5 flex items-center justify-between text-sm hover:bg-muted/50 transition-colors border-b border-border">
            <span className="flex items-center gap-2 font-medium">
              <Users className="h-4 w-4" />
              {t("storyloop.participants.title")}
              {participantCount > 0 && (
                <Badge variant="secondary" className="h-5 text-[10px]">
                  {participantCount}
                </Badge>
              )}
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                isOpen && "rotate-180"
              )}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 py-3 space-y-2 border-b border-border">
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : participants && participants.length > 0 ? (
              <>
                {participants.map((participant) => (
                  <ParticipantRow
                    key={`${participant.user_id}-${participant.role}`}
                    canManage={canManage}
                    currentUserId={currentUserId}
                    onRemove={() => setRemoveTarget(participant)}
                    participant={participant}
                  />
                ))}
              </>
            ) : (
              <p className="text-xs text-muted-foreground py-2">
                {t("storyloop.participants.noParticipants")}
              </p>
            )}

            {canManage && (
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-2"
                onClick={() => setAddDialogOpen(true)}
              >
                <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                {t("storyloop.participants.addParticipant")}
              </Button>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Add participant dialog */}
      <AddParticipantDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        storyId={storyId}
      />

      {/* Remove confirmation */}
      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removeTarget?.user_id === currentUserId
                ? t("storyloop.participants.leaveConfirmTitle")
                : t("storyloop.participants.removeConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget?.user_id === currentUserId
                ? t("storyloop.participants.leaveConfirmDesc")
                : t("storyloop.participants.removeConfirmDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeTarget && handleRemove(removeTarget)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removeTarget?.user_id === currentUserId
                ? t("storyloop.participants.leaveStory")
                : t("storyloop.participants.removeParticipant")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// =====================================================
// Internal sub-components
// =====================================================

interface ParticipantRowProps {
  canManage: boolean;
  currentUserId: string | undefined;
  onRemove: () => void;
  participant: StoryParticipant;
}

function ParticipantRow({
  canManage,
  currentUserId,
  onRemove,
  participant,
}: ParticipantRowProps) {
  const { t } = useTranslation();
  const isSelf = participant.user_id === currentUserId;
  const isOwner = participant.role === "partner";
  const canBeRemoved = canManage || isSelf;
  const roleLabel = t(`storyloop.participants.role.${participant.role}`);

  return (
    <div className="flex items-center gap-2 py-1.5 group">
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {ROLE_ICONS[participant.role] && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-muted-foreground shrink-0">
                {ROLE_ICONS[participant.role]}
              </span>
            </TooltipTrigger>
            <TooltipContent>{roleLabel}</TooltipContent>
          </Tooltip>
        )}
        <span className="text-sm truncate">
          {participant.display_name ?? t("storyloop.unknownUser")}
        </span>
        {isSelf && (
          <Badge variant="outline" className="h-4 text-[10px] shrink-0">
            {t("common.you")}
          </Badge>
        )}
      </div>
      <Badge variant="secondary" className="text-[10px] shrink-0">
        {roleLabel}
      </Badge>
      {canBeRemoved && !isOwner && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              onClick={onRemove}
            >
              {isSelf ? (
                <LogOut className="h-3 w-3" />
              ) : (
                <X className="h-3 w-3" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {isSelf
              ? t("storyloop.participants.leaveStory")
              : t("storyloop.participants.removeParticipant")}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
