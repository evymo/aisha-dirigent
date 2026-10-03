/**
 * StoryRulesetManager — dialog for selecting and pinning expert rules
 * to a story, creating a deterministic ruleset fingerprint.
 *
 * Uses `useExpertRules` to list published rules and
 * `useCreateStoryRuleset` to pin selected rules.
 *
 * @module components/storyloop/StoryRulesetManager
 */

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Search,
  Loader2,
  Fingerprint,
  Tag,
  CheckCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { safeError } from "@/lib/security/safeLogger";
import { useExpertRules } from "@/hooks/useExpertRules";
import { useCreateStoryRuleset } from "@/hooks/useStoryDeliveryContext";

interface StoryRulesetManagerProps {
  storyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently pinned rule IDs (pre-selected) */
  currentRuleIds: string[];
}

/**
 * Dialog for managing the story ruleset — selecting which expert rules
 * are pinned to a story and creating a fingerprinted snapshot.
 */
export function StoryRulesetManager({
  storyId,
  open,
  onOpenChange,
  currentRuleIds,
}: StoryRulesetManagerProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(currentRuleIds),
  );
  const { data: rules, isLoading: rulesLoading } = useExpertRules({ limit: 200 });
  const createRuleset = useCreateStoryRuleset();

  // Sync pre-selected when dialog opens with fresh data
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setSelectedIds(new Set(currentRuleIds));
      setSearch("");
    }
    onOpenChange(newOpen);
  };

  const filteredRules = useMemo(() => {
    if (!rules) return [];
    if (!search.trim()) return rules;
    const q = search.toLowerCase();
    return rules.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        r.ai_context_tags?.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [rules, search]);

  const toggleRule = (ruleId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) {
        next.delete(ruleId);
      } else {
        next.add(ruleId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (selectedIds.size === 0) return;
    try {
      await createRuleset.mutateAsync({
        story_id: storyId,
        rule_ids: Array.from(selectedIds),
      });
      toast.success(t("delivery.ruleset.saveSuccess"));
      onOpenChange(false);
    } catch (err) {
      safeError("StoryRulesetManager.save", err);
      toast.error(t("delivery.ruleset.saveError"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            {t("delivery.ruleset.title")}
          </DialogTitle>
          <DialogDescription>
            {t("delivery.ruleset.description")}
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("delivery.ruleset.searchPlaceholder")}
            className="pl-9"
          />
        </div>

        {/* Rule List */}
        <ScrollArea className="h-72 border rounded-md">
          {rulesLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filteredRules.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {t("delivery.ruleset.noRules")}
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {filteredRules.map((rule) => {
                const isSelected = selectedIds.has(rule.id);
                return (
                  <button
                    key={rule.id}
                    type="button"
                    onClick={() => toggleRule(rule.id)}
                    className={`w-full flex items-start gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 ${
                      isSelected ? "bg-primary/5 ring-1 ring-primary/20" : ""
                    }`}
                  >
                    <Checkbox
                      checked={isSelected}
                      className="mt-0.5 shrink-0"
                      tabIndex={-1}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{rule.title}</span>
                        {rule.is_verified && (
                          <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        )}
                      </div>
                      {rule.summary && (
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                          {rule.summary}
                        </p>
                      )}
                      <div className="flex items-center gap-1.5 mt-1">
                        <Badge variant="outline" className="text-[10px] px-1">
                          <Tag className="h-2.5 w-2.5 mr-0.5" />
                          {t(`guild.category.${rule.category}`)}
                        </Badge>
                        {rule.author_display_name && (
                          <span className="text-[10px] text-muted-foreground">
                            {rule.author_display_name}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Selection summary */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Fingerprint className="h-3.5 w-3.5" />
          {t("delivery.ruleset.selectedCount", { count: selectedIds.size })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={selectedIds.size === 0 || createRuleset.isPending}
          >
            {createRuleset.isPending && (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            )}
            {t("delivery.ruleset.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
