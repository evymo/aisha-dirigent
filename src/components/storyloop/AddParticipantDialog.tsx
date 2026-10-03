/**
 * AddParticipantDialog — search and invite certified partners
 * to collaborate on a story.
 *
 * @module components/storyloop/AddParticipantDialog
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, UserPlus, Loader2, Award } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAddStoryParticipant } from "@/hooks/useStoryParticipants";
import { useSearchCertifiedPartners } from "@/hooks/useSearchCertifiedPartners";
import { useToast } from "@/hooks/use-toast";
import { safeError } from "@/lib/security/safeLogger";

interface AddParticipantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storyId: string;
}

/**
 * Dialog for searching and adding certified partners to a story.
 *
 * @example
 * <AddParticipantDialog open={isOpen} onOpenChange={setIsOpen} storyId={storyId} />
 */
export function AddParticipantDialog({
  open,
  onOpenChange,
  storyId,
}: AddParticipantDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const addParticipant = useAddStoryParticipant();
  const { data: partners, isLoading } = useSearchCertifiedPartners(
    searchQuery,
    { enabled: open && searchQuery.length >= 2 }
  );

  const handleAdd = async (targetUserId: string) => {
    try {
      await addParticipant.mutateAsync({
        story_id: storyId,
        target_user_id: targetUserId,
        role: "guild_expert",
      });
      toast({
        title: t("storyloop.participants.inviteSent"),
        description: t("storyloop.participants.inviteSentDescription"),
      });
      onOpenChange(false);
      setSearchQuery("");
    } catch (error) {
      safeError("storyloop.addParticipantDialog", error);
      toast({
        title: t("storyloop.participants.error"),
        description: t("storyloop.participants.addError"),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("storyloop.participants.addParticipant")}</DialogTitle>
          <DialogDescription>
            {t("storyloop.participants.addParticipantDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("storyloop.participants.searchPartner")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <ScrollArea className="max-h-64">
            {isLoading && searchQuery.length >= 2 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : partners && partners.length > 0 ? (
              <div className="space-y-1">
                {partners.map((partner) => (
                  <div
                    key={partner.user_id}
                    className="flex items-center gap-3 p-2.5 rounded-md hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {partner.display_name}
                      </p>
                      {partner.business_name && (
                        <p className="text-xs text-muted-foreground truncate">
                          {partner.business_name}
                        </p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      <Award className="h-2.5 w-2.5 mr-1" />
                      {t(`storyloop.participants.certificationLevel.${partner.certification_level}`)}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={addParticipant.isPending}
                      onClick={() => handleAdd(partner.user_id)}
                    >
                      <UserPlus className="h-3.5 w-3.5 mr-1" />
                      {t("common.add")}
                    </Button>
                  </div>
                ))}
              </div>
            ) : searchQuery.length >= 2 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {t("storyloop.participants.noParticipants")}
              </p>
            ) : null}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
