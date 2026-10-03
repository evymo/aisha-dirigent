/**
 * StoryDeliveryPanel — collapsible panel showing delivery context
 * for a story: status, repo, tech stack, ruleset fingerprint,
 * participants, and pinned rules.
 *
 * Integrated into StoryDetail as a collapsible section.
 *
 * @module components/storyloop/StoryDeliveryPanel
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  GitBranch,
  Layers,
  Shield,
  Fingerprint,
  Users,
  BookOpen,
  Settings,
  ExternalLink,
  Loader2,
  Plus,
  Trash2,
  GripVertical,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { useToast } from "@/hooks/use-toast";
import {
  useStoryDeliveryContext,
  useUpdateStoryProjectPreview,
} from "@/hooks/useStoryDeliveryContext";
import { StoryRulesetManager } from "./StoryRulesetManager";
import { cn } from "@/lib/utils";

interface StoryDeliveryPanelProps {
  storyId: string;
  defaultOpen?: boolean;
}

function parseLines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function joinLines(value: string[] | undefined): string {
  return (value ?? []).join("\n");
}

interface DraggableListItemProps {
  id: string;
  value: string;
  onUpdate: (value: string) => void;
  onRemove: () => void;
  placeholder?: string;
}

/**
 * Draggable list item with text input and remove button.
 * Supports drag-and-drop reordering.
 */
function DraggableListItem({
  id,
  value,
  onUpdate,
  onRemove,
  placeholder,
}: DraggableListItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 p-2 rounded border bg-card",
        isDragging && "opacity-50 shadow-lg"
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab hover:text-foreground text-muted-foreground shrink-0"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Input
        value={value}
        onChange={(e) => onUpdate(e.target.value)}
        placeholder={placeholder}
        className="flex-1 h-8 text-xs"
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  analyzing: "outline",
  matched: "secondary",
  scaffolding: "secondary",
  ready: "default",
  in_progress: "default",
  blocked: "destructive",
  qa: "secondary",
  delivering: "default",
  delivered: "default",
  archived: "outline",
  maintenance: "secondary",
};

/**
 * Renders delivery context for a story: status, repo, tech stack,
 * pinned ruleset, participants.
 *
 * @example
 * <StoryDeliveryPanel storyId={storyId} />
 */
export function StoryDeliveryPanel({
  storyId,
  defaultOpen = false,
}: StoryDeliveryPanelProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [rulesetManagerOpen, setRulesetManagerOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [goals, setGoals] = useState<string[]>([]);
  const [constraints, setConstraints] = useState<string[]>([]);
  const [successCriteria, setSuccessCriteria] = useState<string[]>([]);
  const { data: ctx, isLoading } = useStoryDeliveryContext(storyId);
  const updateProjectPreview = useUpdateStoryProjectPreview();

  // Drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (!ctx?.project_preview) return;

    setSummary(ctx.project_preview.summary);
    setGoals(ctx.project_preview.goals || []);
    setConstraints(ctx.project_preview.constraints || []);
    setSuccessCriteria(ctx.project_preview.success_criteria || []);
  }, [ctx?.project_preview]);

  const handleDragEnd = (
    event: DragEndEvent,
    list: string[],
    setList: (list: string[]) => void
  ) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = list.findIndex((item) => item === active.id);
      const newIndex = list.findIndex((item) => item === over.id);

      const newList = [...list];
      const [removed] = newList.splice(oldIndex, 1);
      newList.splice(newIndex, 0, removed);

      setList(newList);
    }
  };

  const addGoal = () => setGoals([...goals, ""]);
  const updateGoal = (index: number, value: string) => {
    const newGoals = [...goals];
    newGoals[index] = value;
    setGoals(newGoals);
  };
  const removeGoal = (index: number) => {
    setGoals(goals.filter((_, i) => i !== index));
  };

  const addConstraint = () => setConstraints([...constraints, ""]);
  const updateConstraint = (index: number, value: string) => {
    const newConstraints = [...constraints];
    newConstraints[index] = value;
    setConstraints(newConstraints);
  };
  const removeConstraint = (index: number) => {
    setConstraints(constraints.filter((_, i) => i !== index));
  };

  const addCriteria = () => setSuccessCriteria([...successCriteria, ""]);
  const updateCriteria = (index: number, value: string) => {
    const newCriteria = [...successCriteria];
    newCriteria[index] = value;
    setSuccessCriteria(newCriteria);
  };
  const removeCriteria = (index: number) => {
    setSuccessCriteria(successCriteria.filter((_, i) => i !== index));
  };

  const handleSavePreview = async (publish: boolean) => {
    try {
      // Filter out empty strings
      const filteredGoals = goals.filter((g) => g.trim().length > 0);
      const filteredConstraints = constraints.filter((c) => c.trim().length > 0);
      const filteredCriteria = successCriteria.filter((sc) => sc.trim().length > 0);

      await updateProjectPreview.mutateAsync({
        story_id: storyId,
        publish,
        project_preview: {
          constraints: filteredConstraints,
          goals: filteredGoals,
          success_criteria: filteredCriteria,
          summary: summary.trim(),
        },
      });

      toast({
        title: publish
          ? t("delivery.panel.preview.publishSuccess")
          : t("delivery.panel.preview.saveSuccess"),
      });
    } catch (error) {
      toast({
        title: t("delivery.panel.preview.saveError"),
        description: error instanceof Error ? error.message : t("delivery.panel.preview.saveError"),
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <button className="w-full px-4 py-2.5 flex items-center justify-between text-sm hover:bg-muted/50 transition-colors border-b border-border">
            <span className="flex items-center gap-2 font-medium text-foreground">
              <Layers className="h-4 w-4 text-primary" />
              {t("delivery.panel.title")}
              {ctx?.story?.delivery_status && (
                <Badge
                  variant={STATUS_VARIANT[ctx.story.delivery_status] ?? "outline"}
                  className="text-[10px] px-1.5 py-0"
                >
                  {t(`delivery.status.${ctx.story.delivery_status}`)}
                </Badge>
              )}
            </span>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${
                isOpen ? "rotate-180" : ""
              }`}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 py-3 bg-muted/20 border-b border-border space-y-3">
            {isLoading && (
              <div className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            )}

            {!isLoading && !ctx && (
              <p className="text-xs text-muted-foreground text-center py-2">
                {t("delivery.panel.noContext")}
              </p>
            )}

            {!isLoading && ctx && (
              <>
                {/* Repository */}
                {ctx.story.repo_url && (
                  <div className="flex items-center gap-2 text-xs">
                    <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <a
                      href={ctx.story.repo_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline truncate flex items-center gap-1"
                    >
                      {ctx.story.repo_url.replace(/^https?:\/\//, "")}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                    {ctx.story.default_branch && (
                      <Badge variant="outline" className="text-[10px]">
                        {ctx.story.default_branch}
                      </Badge>
                    )}
                  </div>
                )}

                {/* Tech Stack */}
                {ctx.story.tech_stack && ctx.story.tech_stack.length > 0 && (
                  <div className="flex items-start gap-2 text-xs">
                    <Settings className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex flex-wrap gap-1">
                      {ctx.story.tech_stack.map((tech) => (
                        <Badge key={tech} variant="secondary" className="text-[10px] px-1.5">
                          {tech}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Risk Profile */}
                {ctx.story.risk_profile && (
                  <div className="flex items-center gap-2 text-xs">
                    <Shield className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">
                      {t("delivery.panel.riskProfile")}:
                    </span>
                    <Badge
                      variant={ctx.story.risk_profile === "high" ? "destructive" : "outline"}
                      className="text-[10px]"
                    >
                      {ctx.story.risk_profile}
                    </Badge>
                  </div>
                )}

                {/* Project Preview */}
                <div className="space-y-2 rounded-md border border-border p-2.5">
                  <div className="text-xs font-medium text-foreground">
                    {t("delivery.panel.preview.title")}
                  </div>

                  {/* Summary (simple textarea) */}
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground">
                      {t("delivery.panel.preview.summary")}
                    </label>
                    <Textarea
                      value={summary}
                      onChange={(event) => setSummary(event.target.value)}
                      className="min-h-[72px] text-xs"
                      placeholder={t("delivery.panel.preview.summaryPlaceholder")}
                    />
                  </div>

                  {/* Goals with drag-and-drop */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] text-muted-foreground">
                        {t("delivery.panel.preview.goals")}
                      </label>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-muted-foreground"
                        onClick={addGoal}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {goals.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-1">
                        {t("delivery.panel.preview.listPlaceholder")}
                      </p>
                    ) : (
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={(event) => handleDragEnd(event, goals, setGoals)}
                      >
                        <SortableContext
                          items={goals}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="space-y-1">
                            {goals.map((goal, index) => (
                              <DraggableListItem
                                key={`goal-${index}`}
                                id={goal || `empty-goal-${index}`}
                                value={goal}
                                onUpdate={(value) => updateGoal(index, value)}
                                onRemove={() => removeGoal(index)}
                                placeholder={`${t("delivery.panel.preview.listPlaceholder")} ${
                                  index + 1
                                }`}
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                    )}
                  </div>

                  {/* Constraints with drag-and-drop */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] text-muted-foreground">
                        {t("delivery.panel.preview.constraints")}
                      </label>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-muted-foreground"
                        onClick={addConstraint}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {constraints.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-1">
                        {t("delivery.panel.preview.listPlaceholder")}
                      </p>
                    ) : (
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={(event) =>
                          handleDragEnd(event, constraints, setConstraints)
                        }
                      >
                        <SortableContext
                          items={constraints}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="space-y-1">
                            {constraints.map((constraint, index) => (
                              <DraggableListItem
                                key={`constraint-${index}`}
                                id={constraint || `empty-constraint-${index}`}
                                value={constraint}
                                onUpdate={(value) => updateConstraint(index, value)}
                                onRemove={() => removeConstraint(index)}
                                placeholder={`${t("delivery.panel.preview.listPlaceholder")} ${
                                  index + 1
                                }`}
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                    )}
                  </div>

                  {/* Success Criteria with drag-and-drop */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] text-muted-foreground">
                        {t("delivery.panel.preview.successCriteria")}
                      </label>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-muted-foreground"
                        onClick={addCriteria}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {successCriteria.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-1">
                        {t("delivery.panel.preview.listPlaceholder")}
                      </p>
                    ) : (
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={(event) =>
                          handleDragEnd(event, successCriteria, setSuccessCriteria)
                        }
                      >
                        <SortableContext
                          items={successCriteria}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="space-y-1">
                            {successCriteria.map((criteria, index) => (
                              <DraggableListItem
                                key={`criteria-${index}`}
                                id={criteria || `empty-criteria-${index}`}
                                value={criteria}
                                onUpdate={(value) => updateCriteria(index, value)}
                                onRemove={() => removeCriteria(index)}
                                placeholder={`${t("delivery.panel.preview.listPlaceholder")} ${
                                  index + 1
                                }`}
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                    )}
                  </div>

                  {/* Save/Publish buttons */}
                  <div className="flex gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      disabled={updateProjectPreview.isPending}
                      onClick={() => void handleSavePreview(false)}
                    >
                      {updateProjectPreview.isPending && (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      )}
                      {t("delivery.panel.preview.save")}
                    </Button>
                    <Button
                      size="sm"
                      className="w-full text-xs"
                      disabled={updateProjectPreview.isPending}
                      onClick={() => void handleSavePreview(true)}
                    >
                      {updateProjectPreview.isPending && (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      )}
                      {t("delivery.panel.preview.publish")}
                    </Button>
                  </div>
                </div>

                {/* Ruleset Fingerprint */}
                {ctx.ruleset && (
                  <div className="flex items-center gap-2 text-xs">
                    <Fingerprint className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <Tooltip>
                      <TooltipTrigger>
                        <code className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {ctx.ruleset.fingerprint.slice(0, 16)}...
                        </code>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p className="font-mono text-xs break-all">{ctx.ruleset.fingerprint}</p>
                      </TooltipContent>
                    </Tooltip>
                    <span className="text-muted-foreground">
                      {t("delivery.panel.rulesCount", { count: ctx.ruleset.rule_count ?? 0 })}
                    </span>
                  </div>
                )}

                {/* Pinned Rules Preview */}
                {ctx.rules_preview.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <BookOpen className="h-3.5 w-3.5 shrink-0" />
                      {t("delivery.panel.pinnedRules")}
                    </div>
                    <div className="pl-5 space-y-1">
                      {ctx.rules_preview.map((rule) => (
                        <div
                          key={rule.id}
                          className="text-xs flex items-center justify-between gap-2"
                        >
                          <span className="truncate">{rule.title}</span>
                          <Badge variant="outline" className="text-[9px] px-1 shrink-0">
                            v{rule.version}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Participants */}
                {ctx.participants.length > 0 && (
                  <div className="flex items-center gap-2 text-xs">
                    <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">
                      {t("delivery.panel.participants", { count: ctx.participants.length })}
                    </span>
                  </div>
                )}

                {/* Manage Ruleset Button */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => setRulesetManagerOpen(true)}
                >
                  <BookOpen className="h-3.5 w-3.5 mr-1.5" />
                  {t("delivery.panel.manageRuleset")}
                </Button>
              </>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Ruleset manager dialog */}
      <StoryRulesetManager
        storyId={storyId}
        open={rulesetManagerOpen}
        onOpenChange={setRulesetManagerOpen}
        currentRuleIds={ctx?.rules_preview.map((r) => r.id) ?? []}
      />
    </>
  );
}
