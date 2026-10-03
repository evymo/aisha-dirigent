import { z } from "zod";

/**
 * Zod schemas for question response validation.
 * Used to validate user responses before submitting to RPC.
 */

// Response for "tags" type questions
export const tagResponseSchema = z.object({
  block_code: z.string(),
  values: z.array(z.string()), // Selected tag values (for multiSelect)
  value: z.string().optional(), // Single selected value (for single select)
});

export type TagResponse = z.infer<typeof tagResponseSchema>;

// Response for "feeling_preset" type questions
export const feelingPresetResponseSchema = z.object({
  block_code: z.string(),
  preset_id: z.string(),
  computed_values: z.record(z.number()), // Expanded field values
});

export type FeelingPresetResponse = z.infer<typeof feelingPresetResponseSchema>;

// Response for "scale" type questions
export const scaleResponseSchema = z.object({
  block_code: z.string(),
  value: z.number(),
});

export type ScaleResponse = z.infer<typeof scaleResponseSchema>;

// Response for "boolean" type questions
export const booleanResponseSchema = z.object({
  block_code: z.string(),
  value: z.boolean(),
});

export type BooleanResponse = z.infer<typeof booleanResponseSchema>;

// Response for "text" or "textarea" type questions
export const textResponseSchema = z.object({
  block_code: z.string(),
  value: z.string(),
});

export type TextResponse = z.infer<typeof textResponseSchema>;

// Response for "number" type questions
export const numberResponseSchema = z.object({
  block_code: z.string(),
  value: z.number(),
});

export type NumberResponse = z.infer<typeof numberResponseSchema>;

// Response for "select", "radio" type questions (single value)
export const selectResponseSchema = z.object({
  block_code: z.string(),
  value: z.string(),
  other_value: z.string().optional(), // If "other" was selected
});

export type SelectResponse = z.infer<typeof selectResponseSchema>;

// Response for "checkbox" type questions (multiple values)
export const checkboxResponseSchema = z.object({
  block_code: z.string(),
  values: z.array(z.string()),
  other_value: z.string().optional(),
});

export type CheckboxResponse = z.infer<typeof checkboxResponseSchema>;

// Union type for any response
export type BlockResponse =
  | TagResponse
  | FeelingPresetResponse
  | ScaleResponse
  | BooleanResponse
  | TextResponse
  | NumberResponse
  | SelectResponse
  | CheckboxResponse;

/**
 * Validate response based on question type.
 */
export function validateBlockResponse(questionType: string, response: unknown): BlockResponse {
  switch (questionType) {
    case "tags":
      return tagResponseSchema.parse(response);
    case "feeling_preset":
      return feelingPresetResponseSchema.parse(response);
    case "scale":
      return scaleResponseSchema.parse(response);
    case "boolean":
      return booleanResponseSchema.parse(response);
    case "text":
    case "textarea":
      return textResponseSchema.parse(response);
    case "number":
      return numberResponseSchema.parse(response);
    case "select":
    case "radio":
      return selectResponseSchema.parse(response);
    case "checkbox":
      return checkboxResponseSchema.parse(response);
    default:
      throw new Error(`Unknown question type: ${questionType}`);
  }
}

/**
 * Safe validation that returns null on failure.
 */
export function safeValidateBlockResponse(
  questionType: string,
  response: unknown
): BlockResponse | null {
  try {
    return validateBlockResponse(questionType, response);
  } catch {
    return null;
  }
}

/**
 * Validate tag selection against allowed options.
 */
export function validateTagValues(
  selectedValues: string[],
  allowedValues: string[],
  config: { multiSelect?: boolean; maxSelected?: number; minSelected?: number }
): { valid: boolean; error?: string } {
  // Check all selected values are allowed
  const invalidValues = selectedValues.filter((v) => !allowedValues.includes(v));
  if (invalidValues.length > 0) {
    return { valid: false, error: `Invalid values: ${invalidValues.join(", ")}` };
  }

  // Check multiSelect constraint
  if (!config.multiSelect && selectedValues.length > 1) {
    return { valid: false, error: "Only single selection allowed" };
  }

  // Check maxSelected constraint
  if (config.maxSelected && selectedValues.length > config.maxSelected) {
    return { valid: false, error: `Maximum ${config.maxSelected} selections allowed` };
  }

  // Check minSelected constraint
  if (config.minSelected && selectedValues.length < config.minSelected) {
    return { valid: false, error: `Minimum ${config.minSelected} selections required` };
  }

  return { valid: true };
}
