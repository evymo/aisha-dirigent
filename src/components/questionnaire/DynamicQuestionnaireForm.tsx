/**
 * Dynamická komponenta pro vykreslení formuláře dotazníku z DB bloků.
 *
 * Nahrazuje hardcoded formuláře dynamickým vykreslením na základě
 * `get_questionnaire_blocks_localized` RPC.
 *
 * @module components/questionnaire/DynamicQuestionnaireForm
 */

import { Fragment, useState, useCallback, useEffect, useRef } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { safeWarn } from "@/lib/security/safeLogger";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  CalendarIcon,
  Loader2,
  CheckCircle,
  Circle,
  User,
  Heart,
  Activity,
  ClipboardList,
  FileText,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { format } from "date-fns";
import type { QuestionBlock, QuestionnaireStep } from "@/hooks/useStudyRegistrationQuestionnaire";
import { getQuestionOptionIcon } from "@/components/questionnaire/questionOptionIcons";

// Typ pro odpovědi
export type QuestionnaireResponses = Record<string, unknown>;

/** Mapování section_key na ikonu */
const SECTION_ICONS: Record<string, LucideIcon> = {
  basic_info: User,
  personal: User,
  health: Heart,
  health_history: Heart,
  current_state: Activity,
  lifestyle: Activity,
  symptoms: ClipboardList,
  medications: ClipboardList,
  documents: FileText,
  preferences: Settings,
  default: Circle,
};

/** Získá ikonu pro sekci */
function getSectionIcon(sectionKey: string | null | undefined): LucideIcon {
  if (!sectionKey) return SECTION_ICONS.default;
  return SECTION_ICONS[sectionKey] ?? SECTION_ICONS.default;
}

interface DynamicQuestionnaireFormProps {
  /** Kroky dotazníku s bloky otázek */
  steps: QuestionnaireStep[];
  /** Callback při odeslání */
  onSubmit: (responses: QuestionnaireResponses) => Promise<void>;
  /** Callback při zrušení */
  onCancel?: () => void;
  /** Loading stav */
  isSubmitting?: boolean;
  /** Výchozí hodnoty (pro pokračování) */
  defaultValues?: QuestionnaireResponses;
  /** Titulek formuláře */
  title?: string;
  /** Popis formuláře */
  description?: string;
}

/**
 * Dynamická komponenta formuláře dotazníku.
 *
 * Renderuje kroky a otázky na základě DB konfigurace.
 */
export function DynamicQuestionnaireForm({
  steps,
  onSubmit,
  onCancel,
  isSubmitting = false,
  defaultValues = {},
  title,
  description,
}: DynamicQuestionnaireFormProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);

  const [currentStep, setCurrentStep] = useState(0);
  const [responses, setResponses] = useState<QuestionnaireResponses>(defaultValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const formCardRef = useRef<HTMLDivElement | null>(null);
  const hasNavigatedRef = useRef(false);

  const totalSteps = steps.length;
  const currentStepData = steps[currentStep];
  const isLastStep = currentStep === totalSteps - 1;
  const isFirstStep = currentStep === 0;

  // Progress
  const progress = totalSteps > 0 ? ((currentStep + 1) / totalSteps) * 100 : 0;

  useEffect(() => {
    // Skip first render, only scroll when user actually navigates between steps.
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      return;
    }
    if (typeof window === "undefined") return;

    const targetTop = formCardRef.current
      ? Math.max(window.scrollY + formCardRef.current.getBoundingClientRect().top - 12, 0)
      : 0;

    try {
      window.scrollTo({ top: targetTop, behavior: "smooth" });
    } catch {
      // jsdom/noop environments can throw for scroll APIs
    }
  }, [currentStep]);

  // Aktualizace odpovědi
  const updateResponse = useCallback((blockCode: string, value: unknown) => {
    setResponses((prev) => ({ ...prev, [blockCode]: value }));
    // Clear error when value changes
    setErrors((prev) => {
      const next = { ...prev };
      delete next[blockCode];
      return next;
    });
  }, []);

  // Validace aktuálního kroku
  const validateCurrentStep = useCallback((): boolean => {
    if (!currentStepData) return true;

    const newErrors: Record<string, string> = {};

    for (const block of currentStepData.blocks) {
      if (block.is_required) {
        const value = responses[block.block_code];
        if (value === undefined || value === null || value === "") {
          newErrors[block.block_code] = t("validation.required");
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [currentStepData, responses, t]);

  // Navigace
  const handleNext = useCallback(() => {
    if (!validateCurrentStep()) return;

    // Označ aktuální krok jako dokončený
    setCompletedSteps((prev) => new Set(prev).add(currentStep));

    if (isLastStep) {
      void onSubmit(responses);
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  }, [currentStep, isLastStep, onSubmit, responses, validateCurrentStep]);

  const handlePrev = useCallback(() => {
    if (!isFirstStep) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [isFirstStep]);

  // Přímý skok na krok (pouze dokončené nebo aktuální)
  const handleStepClick = useCallback((stepIndex: number) => {
    if (stepIndex === currentStep) return;
    if (stepIndex < currentStep || completedSteps.has(stepIndex)) {
      setCurrentStep(stepIndex);
    }
  }, [currentStep, completedSteps]);

  // Rendering otázky podle typu
  const renderQuestion = useCallback(
    (block: QuestionBlock) => {
      const value = responses[block.block_code];
      const error = errors[block.block_code];
      const config = block.config ?? {};
      const questionType = block.question_type;

      // Common wrapper
      const Wrapper = ({ children }: { children: React.ReactNode }) => (
        <div className="space-y-2 mb-6">
          <Label className={cn("text-base font-medium", block.is_required && "after:content-['*'] after:ml-1 after:text-destructive")}>
            {block.translated_text || block.block_code}
          </Label>
          {block.translated_description && (
            <p className="text-sm text-muted-foreground">{block.translated_description}</p>
          )}
          {children}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      );

      switch (questionType) {
        case "text":
          return (
            <Wrapper>
              <Input
                value={(value as string) ?? ""}
                onChange={(e) => updateResponse(block.block_code, e.target.value)}
                placeholder={config.placeholder as string}
                maxLength={config.maxLength as number}
              />
            </Wrapper>
          );

        case "textarea":
          return (
            <Wrapper>
              <Textarea
                value={(value as string) ?? ""}
                onChange={(e) => updateResponse(block.block_code, e.target.value)}
                placeholder={config.placeholder as string}
                maxLength={config.maxLength as number}
                rows={config.rows as number ?? 3}
              />
            </Wrapper>
          );

        case "number":
          return (
            <Wrapper>
              <Input
                type="number"
                value={(value as number) ?? ""}
                onChange={(e) => updateResponse(block.block_code, parseFloat(e.target.value) || 0)}
                min={config.min as number}
                max={config.max as number}
                step={config.step as number ?? 1}
              />
            </Wrapper>
          );

        case "scale": {
          const min = (config.min as number) ?? 0;
          const max = (config.max as number) ?? 10;
          const scaleValue = (value as number) ?? Math.floor((min + max) / 2);
          return (
            <Wrapper>
              <div className="flex items-center gap-4">
                <span className="text-sm text-muted-foreground">{min}</span>
                <Slider
                  value={[scaleValue]}
                  onValueChange={(v) => updateResponse(block.block_code, v[0])}
                  min={min}
                  max={max}
                  step={1}
                  className="flex-1"
                />
                <span className="text-sm text-muted-foreground">{max}</span>
                <Badge variant="secondary" className="min-w-[3rem] justify-center">
                  {scaleValue}
                </Badge>
              </div>
            </Wrapper>
          );
        }

        case "boolean": {
          const style = (config.style as string) ?? "switch";
          const trueLabel = (config[`trueLabel_${i18n.language}`] as string) ?? t("common.yes");
          const falseLabel = (config[`falseLabel_${i18n.language}`] as string) ?? t("common.no");
          const boolValue = (value as boolean) ?? false;

          if (style === "buttons") {
            return (
              <Wrapper>
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant={boolValue ? "default" : "outline"}
                    className={cn(
                      "flex-1 h-12 text-base transition-all",
                      boolValue && "ring-2 ring-primary ring-offset-2"
                    )}
                    onClick={() => updateResponse(block.block_code, true)}
                  >
                    {trueLabel}
                  </Button>
                  <Button
                    type="button"
                    variant={!boolValue && value !== undefined ? "default" : "outline"}
                    className={cn(
                      "flex-1 h-12 text-base transition-all",
                      !boolValue && value !== undefined && "ring-2 ring-primary ring-offset-2"
                    )}
                    onClick={() => updateResponse(block.block_code, false)}
                  >
                    {falseLabel}
                  </Button>
                </div>
              </Wrapper>
            );
          }

          return (
            <Wrapper>
              <div className="flex items-center gap-3">
                <Switch
                  checked={boolValue}
                  onCheckedChange={(checked) => updateResponse(block.block_code, checked)}
                />
                <span className="text-sm">
                  {boolValue ? trueLabel : falseLabel}
                </span>
              </div>
            </Wrapper>
          );
        }

        case "select":
        case "radio": {
          const options = (config.options as string[]) ?? [];
          const optionTranslations = block.option_translations ?? {};
          return (
            <Wrapper>
              <RadioGroup
                value={(value as string) ?? ""}
                onValueChange={(v) => updateResponse(block.block_code, v)}
                className="space-y-2"
              >
                {options.map((opt) => (
                  <div key={opt} className="flex items-center space-x-2">
                    <RadioGroupItem value={opt} id={`${block.block_code}-${opt}`} />
                    <Label htmlFor={`${block.block_code}-${opt}`}>
                      {optionTranslations[opt] || opt}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </Wrapper>
          );
        }

        case "dropdown": {
          const dropdownOptions = (config.options as string[]) ?? [];
          const dropdownTranslations = block.option_translations ?? {};
          return (
            <Wrapper>
              <Select
                value={(value as string) ?? ""}
                onValueChange={(v) => updateResponse(block.block_code, v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("common.select")} />
                </SelectTrigger>
                <SelectContent>
                  {dropdownOptions.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {dropdownTranslations[opt] || opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Wrapper>
          );
        }

        case "date": {
          const dateValue = value ? new Date(value as string) : undefined;
          const minAge = typeof config.minAge === "number" ? config.minAge : undefined;
          const maxAge = typeof config.maxAge === "number" ? config.maxAge : undefined;
          const currentYear = new Date().getFullYear();
          const hasBirthDateRange = minAge != null || maxAge != null;
          const fromYear = maxAge != null ? currentYear - maxAge : currentYear - 120;
          const toYear = minAge != null ? currentYear - minAge : currentYear;
          const defaultMonth = dateValue ?? (hasBirthDateRange ? new Date(1979, 5, 1) : undefined);
          return (
            <Wrapper>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !dateValue && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateValue ? format(dateValue, "PPP", { locale: dateLocale }) : t("common.selectDate")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    captionLayout={hasBirthDateRange ? "dropdown" : "buttons"}
                    fromYear={hasBirthDateRange ? fromYear : undefined}
                    toYear={hasBirthDateRange ? toYear : undefined}
                    defaultMonth={defaultMonth}
                    selected={dateValue}
                    onSelect={(date) => updateResponse(block.block_code, date?.toISOString())}
                    locale={dateLocale}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </Wrapper>
          );
        }

        case "tags":
        case "feeling_preset": {
          const tagOptions = (config.options as Array<{ value: string; label_key?: string; emoji?: string }>) ?? [];
          const selectedTags = (value as string[]) ?? [];
          const isMultiSelect = config.multiSelect !== false;
          const layout = (config.layout as string) ?? "wrap";
          const columns = (config.columns as number) ?? 3;
          const optTrans = (block.option_translations ?? {}) as Record<string, string>;

          return (
            <Wrapper>
              <div
                className={cn(
                  layout === "grid" && `grid gap-2`,
                  layout === "wrap" && "flex flex-wrap gap-2"
                )}
                style={layout === "grid" ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
              >
                {tagOptions.map((opt) => {
                  const label = optTrans[opt.value] || opt.value;
                  const isSelected = selectedTags.includes(opt.value);
                  const OptionIcon = getQuestionOptionIcon(block.block_code, opt.value);

                  return (
                    <Button
                      key={opt.value}
                      type="button"
                      variant={isSelected ? "default" : "outline"}
                      className={cn(
                        "flex items-center gap-2",
                        layout === "wrap" && "flex-shrink-0"
                      )}
                      onClick={() => {
                        if (isMultiSelect) {
                          const newValue = isSelected
                            ? selectedTags.filter((t) => t !== opt.value)
                            : [...selectedTags, opt.value];
                          updateResponse(block.block_code, newValue);
                        } else {
                          updateResponse(block.block_code, [opt.value]);
                        }
                      }}
                    >
                      {OptionIcon && <OptionIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                      <span>{label || opt.value}</span>
                    </Button>
                  );
                })}
              </div>
            </Wrapper>
          );
        }

        case "checkbox": {
          const checkboxOptions = (config.options as string[]) ?? [];
          const checkboxTranslations = block.option_translations ?? {};
          const selectedCheckboxes = (value as string[]) ?? [];

          return (
            <Wrapper>
              <div className="space-y-2">
                {checkboxOptions.map((opt) => (
                  <div key={opt} className="flex items-center space-x-2">
                    <Checkbox
                      id={`${block.block_code}-${opt}`}
                      checked={selectedCheckboxes.includes(opt)}
                      onCheckedChange={(checked) => {
                        const newValue = checked
                          ? [...selectedCheckboxes, opt]
                          : selectedCheckboxes.filter((v) => v !== opt);
                        updateResponse(block.block_code, newValue);
                      }}
                    />
                    <Label htmlFor={`${block.block_code}-${opt}`}>
                      {checkboxTranslations[opt] || opt}
                    </Label>
                  </div>
                ))}
              </div>
            </Wrapper>
          );
        }

        default:
          // Fallback pro neznámé typy
          safeWarn("DynamicQuestionnaireForm.unknownQuestionType", {
            blockCode: block.block_code,
            questionType,
          });
          return (
            <Wrapper>
              <Input
                value={(value as string) ?? ""}
                onChange={(e) => updateResponse(block.block_code, e.target.value)}
              />
            </Wrapper>
          );
      }
    },
    [responses, errors, updateResponse, t, i18n.language, dateLocale]
  );

  // Loading state
  if (steps.length === 0) {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardContent className="py-10 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">{t("common.loading")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card ref={formCardRef} className="max-w-2xl mx-auto">
      <CardHeader>
        {title && <CardTitle>{title}</CardTitle>}
        {description && <CardDescription>{description}</CardDescription>}

        {/* Step indicators */}
        <div className="mt-6">
          {/* Mobile: Progress bar */}
          <div className="sm:hidden space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>
                {t("common.step")} {currentStep + 1} / {totalSteps}
              </span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {/* Desktop: Step indicators with icons */}
          <div className="hidden sm:block">
            <div className="flex items-center justify-between">
              {steps.map((step, index) => {
                const isCompleted = completedSteps.has(index);
                const isCurrent = index === currentStep;
                const isClickable = index < currentStep || isCompleted;
                const SectionIcon = getSectionIcon(step.section_key);

                return (
                  <div key={index} className="flex items-center flex-1">
                    {/* Step circle */}
                    <button
                      type="button"
                      onClick={() => handleStepClick(index)}
                      disabled={!isClickable && !isCurrent}
                      className={cn(
                        "flex flex-col items-center gap-1 transition-all",
                        isClickable && "cursor-pointer hover:opacity-80",
                        !isClickable && !isCurrent && "cursor-not-allowed opacity-50"
                      )}
                    >
                      <div
                        className={cn(
                          "w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all",
                          isCompleted && "bg-primary border-primary text-primary-foreground",
                          isCurrent && !isCompleted && "border-primary bg-primary/10 text-primary",
                          !isCompleted && !isCurrent && "border-muted-foreground/30 text-muted-foreground"
                        )}
                      >
                        {isCompleted ? (
                          <CheckCircle className="h-5 w-5" />
                        ) : (
                          <SectionIcon className="h-5 w-5" />
                        )}
                      </div>
                      <span
                        className={cn(
                          "text-xs font-medium text-center max-w-[80px] truncate",
                          isCurrent && "text-primary",
                          !isCurrent && "text-muted-foreground"
                        )}
                      >
                        {step.section_key
                          ? t(`questionnaire.sections.${step.section_key}`)
                          : `${t("common.step")} ${index + 1}`}
                      </span>
                    </button>

                    {/* Connector line */}
                    {index < steps.length - 1 && (
                      <div
                        className={cn(
                          "flex-1 h-0.5 mx-2",
                          completedSteps.has(index) ? "bg-primary" : "bg-muted-foreground/20"
                        )}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* Animated step content */}
        <div
          key={currentStep}
          className="animate-in fade-in-0 slide-in-from-right-4 duration-300"
        >
          {/* Section title with icon */}
          {currentStepData?.section_key && (
            <>
              <div className="flex items-center gap-3 mb-4">
                {(() => {
                  const SectionIcon = getSectionIcon(currentStepData.section_key);
                  return <SectionIcon className="h-6 w-6 text-primary" />;
                })()}
                <h3 className="text-lg font-semibold">
                  {t(`questionnaire.sections.${currentStepData.section_key}`)}
                </h3>
              </div>
              <Separator className="mb-6" />
            </>
          )}

          {/* Questions */}
          <div className="space-y-4">
            {currentStepData?.blocks.map((block) => (
              <Fragment key={block.id}>{renderQuestion(block)}</Fragment>
            ))}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex justify-between mt-8 pt-4 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={isFirstStep ? onCancel : handlePrev}
            disabled={isSubmitting}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            {isFirstStep ? t("common.cancel") : t("common.back")}
          </Button>

          <Button
            type="button"
            onClick={handleNext}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t("common.saving")}
              </>
            ) : isLastStep ? (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                {t("common.submit")}
              </>
            ) : (
              <>
                {t("common.next")}
                <ChevronRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
