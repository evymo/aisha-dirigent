/**
 * TimelineEntryForm - Form for adding entries to member timeline
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { CalendarIcon, Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { MEMBER_ALLOWED_ENTRY_TYPES } from "@/hooks/useMyTimeline";

// Extended schemas
const labResultSchema = z.object({
  analyte: z.string().min(1, "Analyte name is required"),
  value: z.string().min(1, "Value is required"),
  unit: z.string().optional(),
  reference_range: z.string().optional(),
});

const formSchema = z.object({
  entryType: z.enum(["note", "health_event", "document", "message", "lab_result", "blood_analysis"]),
  content: z.string().optional(), // For logic: string or serialized JSON
  occurredAt: z.date().optional(),

  // Specific fields directly in form state for ease of use
  labResult: labResultSchema.optional(),

  bloodAnalysis: z.object({
    lab_name: z.string().optional(),
    results: z.array(labResultSchema),
  }).optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface TimelineEntryFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    storyId: string;
    entryType: string;
    content: string;
    occurredAt?: Date;
  }) => Promise<void>;
  storyId: string;
  isSubmitting?: boolean;
}

export function TimelineEntryForm({
  open,
  onOpenChange,
  onSubmit,
  storyId,
  isSubmitting = false,
}: TimelineEntryFormProps) {
  const { t, i18n } = useTranslation();
  const [calendarOpen, setCalendarOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      entryType: "note",
      content: "",
      occurredAt: undefined,
      bloodAnalysis: {
        results: [{ analyte: "", value: "" }]
      }
    },
  });

  const { fields: bloodFields, append: appendBlood, remove: removeBlood } = useFieldArray({
    control: form.control,
    name: "bloodAnalysis.results"
  });

  const entryType = form.watch("entryType");

  const handleSubmit = async (values: FormValues) => {
    let finalContent = values.content || "";

    // Serialize specialized data
    if (values.entryType === "lab_result" && values.labResult) {
      finalContent = JSON.stringify(values.labResult);
    } else if (values.entryType === "blood_analysis" && values.bloodAnalysis) {
      finalContent = JSON.stringify(values.bloodAnalysis);
    }

    // Basic validation
    if (!finalContent && values.entryType !== 'lab_result' && values.entryType !== 'blood_analysis') {
      form.setError("content", { message: "Content is required" });
      return;
    }

    await onSubmit({
      storyId,
      entryType: values.entryType,
      content: finalContent,
      occurredAt: values.occurredAt,
    });
    form.reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("myTimeline.addEntry")}</DialogTitle>
          <DialogDescription>
            {t("myTimeline.subtitle")}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="entryType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("myTimeline.form.type")}</FormLabel>
                  <Select
                    onValueChange={(val) => {
                      field.onChange(val);
                      // Reset specialized fields if needed or just keep them
                    }}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {MEMBER_ALLOWED_ENTRY_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {t(`myTimeline.entryTypes.${type}`)}
                        </SelectItem>
                      ))}
                      {/* Manually add new allowed types if not yet in hook constant */}
                      <SelectItem value="lab_result">{t("myTimeline.form.labResult")}</SelectItem>
                      <SelectItem value="blood_analysis">{t("myTimeline.form.bloodAnalysis")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* DYNAMIC CONTENT FIELDS */}

            {entryType === "lab_result" ? (
              <div className="space-y-3 border p-3 rounded-md bg-muted/20">
                <FormField
                  control={form.control}
                  name="labResult.analyte"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("myTimeline.form.testName")}</FormLabel>
                      <FormControl><Input placeholder={t("myTimeline.form.analytePlaceholder")} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="labResult.value"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("myTimeline.form.value")}</FormLabel>
                        <FormControl><Input placeholder={t("myTimeline.form.valuePlaceholder")} {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="labResult.unit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("myTimeline.form.unit")}</FormLabel>
                        <FormControl><Input placeholder={t("myTimeline.form.unitPlaceholder")} {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            ) : entryType === "blood_analysis" ? (
              <div className="space-y-3 border p-3 rounded-md bg-muted/20">
                <FormField
                  control={form.control}
                  name="bloodAnalysis.lab_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("myTimeline.form.labName")}</FormLabel>
                      <FormControl><Input placeholder={t("myTimeline.form.labNamePlaceholder")} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <FormLabel>{t("myTimeline.form.results")}</FormLabel>
                    <Button type="button" variant="ghost" size="sm" onClick={() => appendBlood({ analyte: "", value: "" })}>
                      <Plus className="h-4 w-4 mr-1" /> {t("myTimeline.form.addRow")}
                    </Button>
                  </div>

                  {bloodFields.map((field, index) => (
                    <div key={field.id} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-4">
                        <FormField
                          control={form.control}
                          name={`bloodAnalysis.results.${index}.analyte`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl><Input placeholder={t("myTimeline.form.analyteInputPlaceholder")} {...field} /></FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-3">
                        <FormField
                          control={form.control}
                          name={`bloodAnalysis.results.${index}.value`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl><Input placeholder={t("myTimeline.form.valueInputPlaceholder")} {...field} /></FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-3">
                        <FormField
                          control={form.control}
                          name={`bloodAnalysis.results.${index}.unit`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl><Input placeholder={t("myTimeline.form.unitInputPlaceholder")} {...field} /></FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-2">
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeBlood(index)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              // Standard Content Field
              <FormField
                control={form.control}
                name="content"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("myTimeline.form.content")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t("myTimeline.form.contentPlaceholder")}
                        className="min-h-[120px] resize-none"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="occurredAt"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>{t("myTimeline.form.date")}</FormLabel>
                  <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full pl-3 text-left font-normal",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          {field.value ? (
                            format(field.value, "PPP", {
                              locale: getDateFnsLocale(i18n.language),
                            })
                          ) : (
                            <span>{t("myTimeline.form.dateHelp")}</span>
                          )}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={(date) => {
                          field.onChange(date);
                          setCalendarOpen(false);
                        }}
                        disabled={(date) => date > new Date()}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormDescription>
                    {t("myTimeline.form.dateHelp")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                {t("myTimeline.form.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("myTimeline.form.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
