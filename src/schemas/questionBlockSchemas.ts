import { z } from "zod";

/**
 * Zod schemas for question block configuration validation.
 * All block configs are stored in DB as JSONB and validated on load.
 */

// Tag option schema for "tags" type blocks
export const tagOptionSchema = z.object({
  value: z.string().min(1, "Value is required"),
  emoji: z.string().optional(),
  label_key: z.string().optional(),
  description_key: z.string().optional(),
});

export type TagOption = z.infer<typeof tagOptionSchema>;

// Config schema for "tags" type blocks
export const tagsConfigSchema = z.object({
  multiSelect: z.boolean().default(false),
  maxSelected: z.number().min(1).optional(),
  minSelected: z.number().min(0).default(0),
  options: z.array(tagOptionSchema).min(1, "At least one option required"),
  layout: z.enum(["grid", "list", "wrap"]).default("grid"),
  columns: z.number().min(1).max(6).default(2),
});

export type TagsConfig = z.infer<typeof tagsConfigSchema>;

// Feeling preset value mapping
export const feelingPresetValueSchema = z.object({
  id: z.string().min(1),
  emoji: z.string(),
  label_key: z.string().optional(),
  description_key: z.string().optional(),
  // Maps to form field values
  values: z.record(z.number()),
});

export type FeelingPresetValue = z.infer<typeof feelingPresetValueSchema>;

// Config schema for "feeling_preset" type blocks
export const feelingPresetConfigSchema = z.object({
  presets: z.array(feelingPresetValueSchema).min(1, "At least one preset required"),
  showLabels: z.boolean().default(true),
  showDescriptions: z.boolean().default(true),
  size: z.enum(["sm", "md", "lg"]).default("lg"),
});

export type FeelingPresetConfig = z.infer<typeof feelingPresetConfigSchema>;

// Config schema for "scale" type blocks
export const scaleConfigSchema = z.object({
  min: z.number().default(0),
  max: z.number().default(10),
  step: z.number().default(1),
  showValue: z.boolean().default(true),
  lowLabel_key: z.string().optional(),
  highLabel_key: z.string().optional(),
  midLabel_key: z.string().optional(),
  midpoint: z.number().optional(),
  icons: z.array(z.string()).optional(),
});

export type ScaleConfig = z.infer<typeof scaleConfigSchema>;

// Config schema for "boolean" type blocks
export const booleanConfigSchema = z.object({
  trueLabel_key: z.string().optional(),
  falseLabel_key: z.string().optional(),
  style: z.enum(["toggle", "buttons", "cards"]).default("toggle"),
});

export type BooleanConfig = z.infer<typeof booleanConfigSchema>;

// Config schema for "select", "radio", "checkbox" type blocks
export const selectConfigSchema = z.object({
  options: z.array(tagOptionSchema).min(1),
  allowOther: z.boolean().default(false),
  otherLabel_key: z.string().optional(),
});

export type SelectConfig = z.infer<typeof selectConfigSchema>;

// Config schema for text/textarea types
export const textConfigSchema = z.object({
  minLength: z.number().min(0).optional(),
  maxLength: z.number().min(1).optional(),
  placeholder_key: z.string().optional(),
  rows: z.number().min(1).max(20).optional(), // For textarea
});

export type TextConfig = z.infer<typeof textConfigSchema>;

// Config schema for "number" type blocks
export const numberConfigSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  unit_key: z.string().optional(),
});

export type NumberConfig = z.infer<typeof numberConfigSchema>;

// Config schema for "date" type blocks
export const dateConfigSchema = z.object({
  format: z.string().optional(), // e.g. 'DD.MM.YYYY'
  minDate: z.string().optional(),
  maxDate: z.string().optional(),
  placeholder_key: z.string().optional(),
});

export type DateConfig = z.infer<typeof dateConfigSchema>;

// Union config type
export type BlockConfig =
  | TagsConfig
  | FeelingPresetConfig
  | ScaleConfig
  | BooleanConfig
  | SelectConfig
  | TextConfig
  | NumberConfig
  | DateConfig;

/**
 * Validate block config based on question type.
 * Returns parsed config or throws Zod error.
 */
export function validateBlockConfig(questionType: string, config: unknown): BlockConfig {
  switch (questionType) {
    case "tags":
      return tagsConfigSchema.parse(config);
    case "feeling_preset":
      return feelingPresetConfigSchema.parse(config);
    case "scale":
      return scaleConfigSchema.parse(config);
    case "boolean":
      return booleanConfigSchema.parse(config);
    case "select":
    case "radio":
    case "checkbox":
      return selectConfigSchema.parse(config);
    case "text":
    case "textarea":
      return textConfigSchema.parse(config);
    case "number":
      return numberConfigSchema.parse(config);
    case "date":
      return dateConfigSchema.parse(config);
    default:
      // Return config as-is for unknown types (backward compatibility)
      return config as BlockConfig;
  }
}

/**
 * Safe validation that returns null on failure instead of throwing.
 */
export function safeValidateBlockConfig(
  questionType: string,
  config: unknown
): BlockConfig | null {
  try {
    return validateBlockConfig(questionType, config);
  } catch {
    return null;
  }
}

/**
 * Get default config for a question type.
 */
export function getDefaultBlockConfig(questionType: string): BlockConfig {
  switch (questionType) {
    case "tags":
      return {
        multiSelect: false,
        minSelected: 0,
        options: [],
        layout: "grid",
        columns: 2,
      };
    case "feeling_preset":
      return {
        presets: [
          { id: "great", emoji: "smile", label_key: "questionnaires.presets.great", values: {} },
          { id: "okay", emoji: "smile-plus", label_key: "questionnaires.presets.okay", values: {} },
          { id: "meh", emoji: "meh", label_key: "questionnaires.presets.meh", values: {} },
          { id: "tired", emoji: "frown", label_key: "questionnaires.presets.tired", values: {} },
          { id: "struggling", emoji: "annoyed", label_key: "questionnaires.presets.struggling", values: {} },
        ],
        showLabels: true,
        showDescriptions: true,
        size: "lg",
      };
    case "scale":
      return { min: 0, max: 10, step: 1, showValue: true };
    case "boolean":
      return { style: "toggle" };
    case "select":
    case "radio":
    case "checkbox":
      return { options: [], allowOther: false };
    case "text":
    case "textarea":
      return {};
    case "number":
      return {};
    case "date":
      return {};
    default:
      return {};
  }
}
