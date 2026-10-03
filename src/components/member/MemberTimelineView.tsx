/**
 * MemberTimelineView - Complete timeline view for member health diary
 */

import { useState } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import {
  Plus,
  FileText,
  Heart,
  MessageSquare,
  StickyNote,
  Filter,
  Calendar as CalendarIcon,
  Loader2,
  ShoppingBag,
  GraduationCap,
  FlaskConical,
  Activity,
  ClipboardList,
  CreditCard,
  Pill,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { toast } from "sonner";
import {
  useMyTimeline,
  useAddTimelineEntry,
  useMyStories,
  MEMBER_ALLOWED_ENTRY_TYPES,
  SYSTEM_ENTRY_TYPES,
  resolveSystemContent,
  MemberEntryType,
} from "@/hooks/useMyTimeline";
import { useDocumentSignedUrl } from "@/hooks/useDocumentSignedUrl";
import { TimelineEntryForm } from "./TimelineEntryForm";

type EntryTypeFilter = "all" | "member" | "system" | "note" | "health_event" | "document" | "message" | "lab_result" | "blood_analysis" |
  "product_log" | "health_log" |
  "system_check_in" | "system_dosing" | "system_registration" | "system_health_sync" | "system_lab_result" | "system_order" | "system_questionnaire";

const entryTypeIcons: Record<string, typeof Heart> = {
  note: StickyNote,
  health_event: Heart,
  document: FileText,
  message: MessageSquare,
  lab_result: FlaskConical,
  blood_analysis: FlaskConical,
  product_log: Pill,
  health_log: Heart,
  // System entry types
  system_registration: GraduationCap,
  system_order: ShoppingBag,
  system_lab_result: FlaskConical,
  system_check_in: Activity,
  system_health_sync: Activity,
  system_dosing: Pill,
  system_payment: CreditCard,
  system_questionnaire: ClipboardList,
  system_document: FileText,
  // Fallback
  system: CalendarIcon,
};

const entryTypeColors: Record<string, string> = {
  note: "text-blue-500 bg-blue-500/10",
  health_event: "text-red-500 bg-red-500/10",
  document: "text-green-500 bg-green-500/10",
  message: "text-purple-500 bg-purple-500/10",
  lab_result: "text-cyan-600 bg-cyan-600/10",
  blood_analysis: "text-cyan-700 bg-cyan-700/10",
  product_log: "text-violet-500 bg-violet-500/10",
  health_log: "text-rose-500 bg-rose-500/10",
  // System entry types
  system_registration: "text-indigo-500 bg-indigo-500/10",
  system_order: "text-amber-500 bg-amber-500/10",
  system_lab_result: "text-cyan-500 bg-cyan-500/10",
  system_check_in: "text-emerald-500 bg-emerald-500/10",
  system_health_sync: "text-sky-500 bg-sky-500/10",
  system_dosing: "text-violet-500 bg-violet-500/10",
  system_payment: "text-pink-500 bg-pink-500/10",
  system_questionnaire: "text-orange-500 bg-orange-500/10",
  system_document: "text-teal-500 bg-teal-500/10",
  // Fallback
  system: "text-gray-500 bg-gray-500/10",
};

interface LabResultData {
  analyte: string;
  value: string;
  unit?: string;
}

interface BloodAnalysisData {
  lab_name?: string;
  results: LabResultData[];
}

interface MemberTimelineViewProps {
  className?: string;
  maxHeight?: string;
}

// Helper to render content based on type
function EntryContent({ type, content, t, metadata }: { type: string; content: string; t: (key: string) => string; metadata: Record<string, unknown> | null }) {
  if (type === "lab_result") {
    try {
      const data = JSON.parse(content) as LabResultData;
      return (
        <div className="flex flex-col gap-1">
          <span className="font-semibold">{data.analyte}</span>
          <div className="flex gap-2 text-sm">
            <span>{data.value}</span>
            <span className="text-muted-foreground">{data.unit}</span>
          </div>
        </div>
      );
    } catch {
      return <span>{content}</span>;
    }
  }

  if (type === "blood_analysis") {
    try {
      const data = JSON.parse(content) as BloodAnalysisData;
      return (
        <div className="flex flex-col gap-2">
          {data.lab_name && <span className="text-xs font-semibold text-muted-foreground">{data.lab_name}</span>}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {data.results?.map((res, idx) => (
              <div key={idx} className="flex justify-between border-b border-border/50 pb-0.5">
                <span>{res.analyte}</span>
                <span className="font-medium">{res.value} <span className="text-xs text-muted-foreground font-normal">{res.unit}</span></span>
              </div>
            ))}
          </div>
        </div>
      );
    } catch {
      return <span>{content}</span>;
    }
  }

  // Default Rendering
  return (
    <p className="text-sm whitespace-pre-wrap">
      {resolveSystemContent(
        content,
        t,
        metadata,
      )}
    </p>
  );
}

export function MemberTimelineView({
  className,
  maxHeight = "600px",
}: MemberTimelineViewProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);

  // State
  const [filter, setFilter] = useState<EntryTypeFilter>("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [formOpen, setFormOpen] = useState(false);

  // Build entry_types filter
  const entryTypes = (() => {
    if (filter === "all") return undefined;
    if (filter === "member") return [...MEMBER_ALLOWED_ENTRY_TYPES];
    if (filter === "system") return [...SYSTEM_ENTRY_TYPES];
    return [filter];
  })();

  // Data hooks
  const {
    data: timeline,
    isLoading,
    error,
  } = useMyTimeline({
    limit: 100,
    entryTypes,
    dateFrom: dateFrom?.toISOString(),
    dateTo: dateTo?.toISOString(),
  });

  const { data: stories } = useMyStories();
  const addEntry = useAddTimelineEntry();
  const openAnalysisFile = useDocumentSignedUrl();

  // Get first story for adding entries
  const defaultStory = stories?.[0];

  const handleAddEntry = async (data: {
    storyId: string;
    entryType: string;
    content: string;
    occurredAt?: Date;
  }) => {
    try {
      await addEntry.mutateAsync({
        storyId: data.storyId,
        entryType: data.entryType as MemberEntryType,
        content: data.content,
        occurredAt: data.occurredAt?.toISOString(),
      });
      toast(t("myTimeline.success"));
    } catch {
      toast.error(t("myTimeline.error"));
      throw new Error("Failed to add entry");
    }
  };

  const handleOpenAnalysisFile = async (bucket: string, storagePath: string) => {
    try {
      const { signedUrl } = await openAnalysisFile.mutateAsync({
        bucket,
        storagePath,
        expiresIn: 120,
      });
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast.error(t("myTimeline.error"));
    }
  };

  const filterOptions: { value: EntryTypeFilter; label: string }[] = [
    { value: "all", label: t("myTimeline.filter.all") },
    { value: "member", label: t("myTimeline.filter.member") },
    { value: "system", label: t("myTimeline.filter.system") },
    { value: "note", label: t("myTimeline.entryTypes.note") },
    { value: "health_event", label: t("myTimeline.entryTypes.health_event") },
    { value: "product_log", label: t("myTimeline.entryTypes.product_log") },
    { value: "health_log", label: t("myTimeline.entryTypes.health_log") },
    { value: "lab_result", label: t("myTimeline.entryTypes.lab_result") },
    { value: "blood_analysis", label: t("myTimeline.entryTypes.blood_analysis") },
    { value: "system_registration", label: t("myTimeline.entryTypes.system_registration") },
    { value: "system_order", label: t("myTimeline.entryTypes.system_order") },
    { value: "system_lab_result", label: t("myTimeline.entryTypes.system_lab_result") },
    { value: "system_check_in", label: t("myTimeline.entryTypes.system_check_in") },
    { value: "system_health_sync", label: t("myTimeline.entryTypes.system_health_sync") },
    { value: "system_questionnaire", label: t("myTimeline.entryTypes.system_questionnaire") },
    { value: "system_dosing", label: t("myTimeline.entryTypes.system_dosing") },
  ];

  if (isLoading) {
    return (
      <Card className={cn("animate-pulse", className)}>
        <CardContent className="p-6">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={cn(className)}>
        <CardContent className="p-6">
          <div className="text-center text-destructive py-8">
            {t("common.error")}
          </div>
        </CardContent>
      </Card>
    );
  }

  const entries = timeline?.entries ?? [];

  return (
    <>
      <Card className={className}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-lg">{t("myTimeline.title")}</CardTitle>

            <div className="flex items-center gap-2">
              {/* Date range filter */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <CalendarIcon className="h-4 w-4 mr-1" />
                    {dateFrom || dateTo
                      ? `${dateFrom ? format(dateFrom, "d.M.", { locale: dateLocale }) : "..."} - ${dateTo ? format(dateTo, "d.M.", { locale: dateLocale }) : "..."}`
                      : t("myTimeline.dateRange.from")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <div className="p-3 space-y-3">
                    <div>
                      <p className="text-sm font-medium mb-1">
                        {t("myTimeline.dateRange.from")}
                      </p>
                      <Calendar
                        mode="single"
                        selected={dateFrom}
                        onSelect={setDateFrom}
                        disabled={(date) =>
                          dateTo ? date > dateTo : date > new Date()
                        }
                      />
                    </div>
                    <div>
                      <p className="text-sm font-medium mb-1">
                        {t("myTimeline.dateRange.to")}
                      </p>
                      <Calendar
                        mode="single"
                        selected={dateTo}
                        onSelect={setDateTo}
                        disabled={(date) =>
                          dateFrom ? date < dateFrom : date > new Date()
                        }
                      />
                    </div>
                    {(dateFrom || dateTo) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          setDateFrom(undefined);
                          setDateTo(undefined);
                        }}
                      >
                        {t("myTimeline.dateRange.clear")}
                      </Button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              {/* Type filter */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Filter className="h-4 w-4 mr-1" />
                    {filterOptions.find((f) => f.value === filter)?.label}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {filterOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={() => setFilter(option.value)}
                    >
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Add entry button */}
              {defaultStory && (
                <Button size="sm" onClick={() => setFormOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  {t("myTimeline.addEntry")}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {entries.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              <StickyNote className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{defaultStory ? t("myTimeline.empty") : t("myTimeline.noStories")}</p>
              {defaultStory && (
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => setFormOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  {t("myTimeline.addEntry")}
                </Button>
              )}
            </div>
          ) : (
            <ScrollArea style={{ maxHeight }}>
              <div className="space-y-4 relative">
                {/* Timeline line */}
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

                {entries.map((entry) => {
                  const Icon = entryTypeIcons[entry.entry_type] || StickyNote;
                  const colorClass =
                    entryTypeColors[entry.entry_type] || entryTypeColors.note;
                  const metadata = entry.metadata as Record<string, unknown> | null;
                  const analysisFileName =
                    typeof metadata?.analysis_file_name === "string"
                      ? metadata.analysis_file_name
                      : null;
                  const analysisFileBucket =
                    typeof metadata?.analysis_file_bucket === "string"
                      ? metadata.analysis_file_bucket
                      : "wearable-analysis";
                  const analysisFilePath =
                    typeof metadata?.analysis_file_path === "string"
                      ? metadata.analysis_file_path
                      : null;

                  return (
                    <div
                      key={entry.id}
                      className="relative pl-10 pb-4"
                    >
                      {/* Timeline dot */}
                      <div
                        className={cn(
                          "absolute left-2 w-5 h-5 rounded-full flex items-center justify-center",
                          colorClass
                        )}
                      >
                        <Icon className="h-3 w-3" />
                      </div>

                      {/* Entry card */}
                      <div className="bg-muted/50 rounded-lg p-3">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">
                            {t(`myTimeline.entryTypes.${entry.entry_type}`) || entry.entry_type.replace('_', ' ')}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {format(
                              new Date(entry.occurred_at ?? entry.created_at),
                              "d. MMM yyyy, HH:mm",
                              { locale: dateLocale }
                            )}
                          </span>
                        </div>

                        <EntryContent
                          type={entry.entry_type}
                          content={entry.content || ''}
                          t={t}
                          metadata={metadata}
                        />

                        {entry.entry_type === "system_health_sync" && analysisFilePath && (
                          <div className="mt-2 space-y-1">
                            <p className="text-xs text-muted-foreground">
                              {analysisFileName ?? analysisFilePath}
                            </p>
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-xs"
                              disabled={openAnalysisFile.isPending}
                              onClick={() =>
                                void handleOpenAnalysisFile(
                                  analysisFileBucket,
                                  analysisFilePath,
                                )
                              }
                            >
                              <ExternalLink className="h-3 w-3 mr-1" />
                              {t("common.download")}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Add entry form */}
      {defaultStory && (
        <TimelineEntryForm
          open={formOpen}
          onOpenChange={setFormOpen}
          onSubmit={handleAddEntry}
          storyId={defaultStory.id}
          isSubmitting={addEntry.isPending}
        />
      )}
    </>
  );
}
