import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RatingButtons } from "@/components/ui/rating-buttons";
import { TagSelector, type TagOption } from "@/components/ui/tag-selector";
import { FeelingPresetSelector, type FeelingPreset } from "@/components/ui/feeling-preset-selector";
import { Label } from "@/components/ui/label";
import {
  type TagsConfig,
  type FeelingPresetConfig,
  type ScaleConfig,
  type BooleanConfig,
  type SelectConfig,
  type TextConfig,
  type NumberConfig,
  type DateConfig,
  safeValidateBlockConfig,
  type BlockConfig,
} from "@/schemas/questionBlockSchemas";
import { cn } from "@/lib/utils";
import type { ValidatedQuestionBlock } from "@/hooks/useQuestionBlocks";
import { getQuestionOptionIcon } from "@/components/questionnaire/questionOptionIcons";

/**
 * Props for QuestionBlockRenderer.
 * Supports both legacy QuestionBlockData and new ValidatedQuestionBlock.
 */
export interface QuestionBlockRendererProps {
  block: ValidatedQuestionBlock | LegacyQuestionBlockData;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  error?: string;
  className?: string;
}

/**
 * Legacy block data format for backward compatibility.
 */
export interface LegacyQuestionBlockData {
  id: string;
  code: string;
  question_type: string;
  is_required_default: boolean;
  text_key: string;
  description_key: string | null;
  config: unknown;
  base_locale: string;
  is_active: boolean;
}

/**
 * Type guard to check if block is ValidatedQuestionBlock.
 */
function isValidatedBlock(block: ValidatedQuestionBlock | LegacyQuestionBlockData): block is ValidatedQuestionBlock {
  return "block_code" in block && "translatedText" in block;
}

/**
 * QuestionBlockRenderer - Dynamic renderer for question blocks.
 * Supports both legacy format and new ValidatedQuestionBlock with translations.
 */
export function QuestionBlockRenderer({
  block,
  value,
  onChange,
  disabled = false,
  error,
  className,
}: QuestionBlockRendererProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as "en" | "cs";

  // Normalize block data
  const blockCode = isValidatedBlock(block) ? block.block_code : block.code;
  const blockText = isValidatedBlock(block) ? block.translatedText : block.text_key;
  const blockDescription = isValidatedBlock(block) ? block.translatedDescription : undefined;
  const isRequired = isValidatedBlock(block) ? block.is_required : block.is_required_default;

  // Get validated config
  const validatedConfig: BlockConfig | null = useMemo(() => {
    if (isValidatedBlock(block)) {
      return block.config;
    }
    return safeValidateBlockConfig(block.question_type, block.config);
  }, [block]);

  // Get option translations map from block (for dynamic DB translations)
  const optionTranslations = useMemo(() => {
    if (isValidatedBlock(block) && block.optionTranslations) {
      return block.optionTranslations;
    }
    return {};
  }, [block]);

  // Helper to get localized label for an option via DB translation
  const getOptionLabel = useCallback(
    (opt: { label_key?: string }) => {
      if (opt.label_key && optionTranslations[opt.label_key]) {
        return optionTranslations[opt.label_key];
      }
      return "";
    },
    [optionTranslations]
  );

  // Helper to get localized description for an option via DB translation
  const getOptionDescription = useCallback(
    (opt: { description_key?: string }) => {
      if (opt.description_key && optionTranslations[opt.description_key]) {
        return optionTranslations[opt.description_key];
      }
      return undefined;
    },
    [optionTranslations]
  );

  // Render based on question type
  const renderInput = () => {
    switch (block.question_type) {
      case "tags": {
        const config = validatedConfig as TagsConfig | null;
        if (!config) return <div className="text-destructive">{t("questionBlock.invalidTagsConfig")}</div>;

        const options: TagOption[] = config.options.map((opt) => {
          const icon = getQuestionOptionIcon(blockCode, opt.value);
          return {
            value: opt.value,
            icon: icon ?? undefined,
            label: getOptionLabel(opt),
            description: getOptionDescription(opt),
          };
        });

        return (
          <TagSelector
            options={options}
            selected={Array.isArray(value) ? (value as string[]) : []}
            onChange={onChange}
            multiSelect={config.multiSelect}
            maxSelected={config.maxSelected}
            minSelected={config.minSelected}
            layout={config.layout}
            columns={config.columns}
            disabled={disabled}
          />
        );
      }

      case "feeling_preset": {
        const config = validatedConfig as FeelingPresetConfig | null;
        if (!config) return <div className="text-destructive">{t("questionBlock.invalidFeelingPresetConfig")}</div>;

        const presets: FeelingPreset[] = config.presets.map((p) => ({
          id: p.id,
          emoji: p.emoji,
          label: getOptionLabel(p),
          description: getOptionDescription(p),
          values: p.values,
        }));

        return (
          <FeelingPresetSelector
            presets={presets}
            selectedPresetId={typeof value === "string" ? value : undefined}
            onChange={(preset) => onChange(preset.id)}
            showLabels={config.showLabels}
            showDescriptions={config.showDescriptions}
            size={config.size}
            disabled={disabled}
          />
        );
      }

      case "scale": {
        const config = validatedConfig as ScaleConfig | null;
        const min = config?.min ?? 0;
        const max = config?.max ?? 10;
        const lowLabel = config?.lowLabel_key ? optionTranslations[config.lowLabel_key] : undefined;
        const highLabel = config?.highLabel_key ? optionTranslations[config.highLabel_key] : undefined;
        const midLabel = config?.midLabel_key ? optionTranslations[config.midLabel_key] : undefined;

        return (
          <RatingButtons
            value={typeof value === "number" ? value : undefined}
            onChange={onChange}
            min={min}
            max={max}
            labels={lowLabel && highLabel ? { low: lowLabel, high: highLabel, mid: midLabel || undefined } : undefined}
            icons={config?.icons}
            disabled={disabled}
          />
        );
      }

      case "boolean": {
        const config = validatedConfig as BooleanConfig | null;
        const boolConfig = config || { style: "toggle" };

        const trueLabel = (boolConfig.trueLabel_key && optionTranslations[boolConfig.trueLabel_key]) || "";
        const falseLabel = (boolConfig.falseLabel_key && optionTranslations[boolConfig.falseLabel_key]) || "";

        if (boolConfig.style === "toggle") {
          return (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">{falseLabel}</span>
              <Switch
                checked={value === true}
                onCheckedChange={onChange}
                disabled={disabled}
              />
              <span className="text-sm text-muted-foreground">{trueLabel}</span>
            </div>
          );
        }

        // Buttons style
        return (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => onChange(false)}
              disabled={disabled}
              className={cn(
                "px-6 py-3 rounded-lg border-2 transition-all",
                value === false
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/50"
              )}
            >
              {falseLabel}
            </button>
            <button
              type="button"
              onClick={() => onChange(true)}
              disabled={disabled}
              className={cn(
                "px-6 py-3 rounded-lg border-2 transition-all",
                value === true
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/50"
              )}
            >
              {trueLabel}
            </button>
          </div>
        );
      }

      case "select": {
        const config = validatedConfig as SelectConfig | null;
        if (!config) return <div className="text-destructive">{t("questionBlock.invalidSelectConfig")}</div>;

        return (
          <Select
            value={typeof value === "string" ? value : ""}
            onValueChange={onChange}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {config.options.map((opt) => {
                const OptionIcon = getQuestionOptionIcon(blockCode, opt.value);
                return (
                  <SelectItem key={opt.value} value={opt.value}>
                    {OptionIcon && <OptionIcon className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                    {getOptionLabel(opt)}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        );
      }

      case "radio": {
        const config = validatedConfig as SelectConfig | null;
        if (!config) return <div className="text-destructive">{t("questionBlock.invalidRadioConfig")}</div>;

        return (
          <RadioGroup
            value={typeof value === "string" ? value : ""}
            onValueChange={onChange}
            disabled={disabled}
            className="space-y-2"
          >
            {config.options.map((opt) => {
              const OptionIcon = getQuestionOptionIcon(blockCode, opt.value);
              return (
                <div key={opt.value} className="flex items-center gap-3">
                  <RadioGroupItem value={opt.value} id={`${blockCode}-${opt.value}`} />
                  <Label htmlFor={`${blockCode}-${opt.value}`} className="flex items-center gap-2">
                    {OptionIcon && <OptionIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                    {getOptionLabel(opt)}
                  </Label>
                </div>
              );
            })}
          </RadioGroup>
        );
      }

      case "checkbox": {
        const config = validatedConfig as SelectConfig | null;
        if (!config) return <div className="text-destructive">{t("questionBlock.invalidCheckboxConfig")}</div>;

        const selectedValues = Array.isArray(value) ? (value as string[]) : [];

        return (
          <div className="space-y-2">
            {config.options.map((opt) => {
              const OptionIcon = getQuestionOptionIcon(blockCode, opt.value);
              return (
                <div key={opt.value} className="flex items-center gap-3">
                  <Checkbox
                    id={`${blockCode}-${opt.value}`}
                    checked={selectedValues.includes(opt.value)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        onChange([...selectedValues, opt.value]);
                      } else {
                        onChange(selectedValues.filter((v) => v !== opt.value));
                      }
                    }}
                    disabled={disabled}
                  />
                  <Label htmlFor={`${blockCode}-${opt.value}`} className="flex items-center gap-2">
                    {OptionIcon && <OptionIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                    {getOptionLabel(opt)}
                  </Label>
                </div>
              );
            })}
          </div>
        );
      }

      case "text": {
        const config = validatedConfig as TextConfig | null;
        const textConfig = config || {};
        const placeholder = textConfig.placeholder_key
          ? optionTranslations[textConfig.placeholder_key]
          : undefined;

        return (
          <Input
            type="text"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            maxLength={textConfig.maxLength}
            disabled={disabled}
          />
        );
      }

      case "textarea": {
        const config = validatedConfig as TextConfig | null;
        const textConfig = config || {};
        const placeholder = textConfig.placeholder_key
          ? optionTranslations[textConfig.placeholder_key]
          : undefined;

        return (
          <Textarea
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            maxLength={textConfig.maxLength}
            rows={textConfig.rows || 4}
            disabled={disabled}
          />
        );
      }

      case "number": {
        const config = validatedConfig as NumberConfig | null;
        const numConfig = config || {};
        const unit = numConfig.unit_key
          ? optionTranslations[numConfig.unit_key]
          : undefined;

        return (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={typeof value === "number" ? value : ""}
              onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
              min={numConfig.min}
              max={numConfig.max}
              step={numConfig.step}
              disabled={disabled}
              className="max-w-[200px]"
            />
            {unit && <span className="text-muted-foreground">{unit}</span>}
          </div>
        );
      }

      case "date": {
        const config = validatedConfig as DateConfig | null;
        const dateConfig = config || {};
        const placeholder = dateConfig.placeholder_key
          ? optionTranslations[dateConfig.placeholder_key]
          : locale === "cs" ? "DD.MM.RRRR" : "DD/MM/YYYY";

        return (
          <Input
            type="date"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            className="max-w-[200px]"
          />
        );
      }

      default:
        return (
          <div className="text-muted-foreground">
            {t("questionBlock.unknownQuestionType", { type: block.question_type })}
          </div>
        );
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Label */}
      <div className="space-y-1">
        <Label className="text-base font-medium">
          {blockText}
          {isRequired && <span className="text-destructive ml-1">*</span>}
        </Label>
        {blockDescription && (
          <p className="text-sm text-muted-foreground">{blockDescription}</p>
        )}
      </div>

      {/* Input */}
      {renderInput()}

      {/* Error */}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
