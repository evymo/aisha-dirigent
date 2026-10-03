import { describe, it, expect } from 'vitest';
import {
  tagResponseSchema,
  feelingPresetResponseSchema,
  scaleResponseSchema,
  booleanResponseSchema,
  textResponseSchema,
  numberResponseSchema,
  selectResponseSchema,
  checkboxResponseSchema,
  validateBlockResponse,
  safeValidateBlockResponse,
  validateTagValues,
  type TagResponse,
  type FeelingPresetResponse,
  type ScaleResponse,
  type SelectResponse,
  type CheckboxResponse,
} from '@/schemas/questionResponseSchemas';

describe('questionResponseSchemas', () => {
  describe('tagResponseSchema', () => {
    it('validates valid tag response with values array', () => {
      const valid = {
        block_code: 'health_tags',
        values: ['immunity', 'energy'],
      };
      const result = tagResponseSchema.parse(valid);
      expect(result.values).toEqual(['immunity', 'energy']);
    });

    it('validates tag response with single value', () => {
      const valid = {
        block_code: 'health_tags',
        values: [],
        value: 'immunity',
      };
      const result = tagResponseSchema.parse(valid);
      expect(result.value).toBe('immunity');
    });

    it('requires block_code', () => {
      const invalid = { values: ['test'] };
      expect(() => tagResponseSchema.parse(invalid)).toThrow();
    });

    it('requires values array', () => {
      const invalid = { block_code: 'test' };
      expect(() => tagResponseSchema.parse(invalid)).toThrow();
    });
  });

  describe('feelingPresetResponseSchema', () => {
    it('validates valid feeling preset response', () => {
      const valid = {
        block_code: 'feeling',
        preset_id: 'great',
        computed_values: { energy: 8, mood: 9 },
      };
      const result = feelingPresetResponseSchema.parse(valid);
      expect(result.preset_id).toBe('great');
      expect(result.computed_values).toEqual({ energy: 8, mood: 9 });
    });

    it('requires preset_id', () => {
      const invalid = {
        block_code: 'feeling',
        computed_values: {},
      };
      expect(() => feelingPresetResponseSchema.parse(invalid)).toThrow();
    });

    it('requires computed_values to be number record', () => {
      const invalid = {
        block_code: 'feeling',
        preset_id: 'great',
        computed_values: { energy: 'high' },
      };
      expect(() => feelingPresetResponseSchema.parse(invalid)).toThrow();
    });

    it('allows empty computed_values', () => {
      const valid = {
        block_code: 'feeling',
        preset_id: 'neutral',
        computed_values: {},
      };
      expect(() => feelingPresetResponseSchema.parse(valid)).not.toThrow();
    });
  });

  describe('scaleResponseSchema', () => {
    it('validates valid scale response', () => {
      const valid = {
        block_code: 'pain_level',
        value: 5,
      };
      const result = scaleResponseSchema.parse(valid);
      expect(result.value).toBe(5);
    });

    it('requires numeric value', () => {
      const invalid = {
        block_code: 'pain_level',
        value: '5',
      };
      expect(() => scaleResponseSchema.parse(invalid)).toThrow();
    });

    it('allows decimal values', () => {
      const valid = {
        block_code: 'rating',
        value: 4.5,
      };
      const result = scaleResponseSchema.parse(valid);
      expect(result.value).toBe(4.5);
    });
  });

  describe('booleanResponseSchema', () => {
    it('validates true value', () => {
      const valid = { block_code: 'agree', value: true };
      const result = booleanResponseSchema.parse(valid);
      expect(result.value).toBe(true);
    });

    it('validates false value', () => {
      const valid = { block_code: 'agree', value: false };
      const result = booleanResponseSchema.parse(valid);
      expect(result.value).toBe(false);
    });

    it('rejects non-boolean values', () => {
      expect(() => booleanResponseSchema.parse({ block_code: 'test', value: 1 })).toThrow();
      expect(() => booleanResponseSchema.parse({ block_code: 'test', value: 'yes' })).toThrow();
      expect(() => booleanResponseSchema.parse({ block_code: 'test', value: null })).toThrow();
    });
  });

  describe('textResponseSchema', () => {
    it('validates valid text response', () => {
      const valid = {
        block_code: 'notes',
        value: 'Some user input text',
      };
      const result = textResponseSchema.parse(valid);
      expect(result.value).toBe('Some user input text');
    });

    it('allows empty string', () => {
      const valid = { block_code: 'notes', value: '' };
      expect(() => textResponseSchema.parse(valid)).not.toThrow();
    });

    it('requires string value', () => {
      const invalid = { block_code: 'notes', value: 123 };
      expect(() => textResponseSchema.parse(invalid)).toThrow();
    });
  });

  describe('numberResponseSchema', () => {
    it('validates valid number response', () => {
      const valid = { block_code: 'age', value: 30 };
      const result = numberResponseSchema.parse(valid);
      expect(result.value).toBe(30);
    });

    it('allows negative numbers', () => {
      const valid = { block_code: 'temperature', value: -5 };
      expect(() => numberResponseSchema.parse(valid)).not.toThrow();
    });

    it('allows zero', () => {
      const valid = { block_code: 'count', value: 0 };
      const result = numberResponseSchema.parse(valid);
      expect(result.value).toBe(0);
    });

    it('rejects string numbers', () => {
      const invalid = { block_code: 'age', value: '30' };
      expect(() => numberResponseSchema.parse(invalid)).toThrow();
    });
  });

  describe('selectResponseSchema', () => {
    it('validates valid select response', () => {
      const valid = {
        block_code: 'gender',
        value: 'male',
      };
      const result = selectResponseSchema.parse(valid);
      expect(result.value).toBe('male');
    });

    it('validates response with other_value', () => {
      const valid = {
        block_code: 'gender',
        value: 'other',
        other_value: 'Non-binary',
      };
      const result = selectResponseSchema.parse(valid);
      expect(result.other_value).toBe('Non-binary');
    });

    it('allows undefined other_value', () => {
      const valid = { block_code: 'gender', value: 'male' };
      const result = selectResponseSchema.parse(valid);
      expect(result.other_value).toBeUndefined();
    });
  });

  describe('checkboxResponseSchema', () => {
    it('validates valid checkbox response', () => {
      const valid = {
        block_code: 'symptoms',
        values: ['headache', 'fatigue', 'nausea'],
      };
      const result = checkboxResponseSchema.parse(valid);
      expect(result.values).toHaveLength(3);
    });

    it('validates response with other_value', () => {
      const valid = {
        block_code: 'symptoms',
        values: ['headache', 'other'],
        other_value: 'Dizziness',
      };
      const result = checkboxResponseSchema.parse(valid);
      expect(result.other_value).toBe('Dizziness');
    });

    it('allows empty values array', () => {
      const valid = { block_code: 'symptoms', values: [] };
      expect(() => checkboxResponseSchema.parse(valid)).not.toThrow();
    });

    it('requires values to be array of strings', () => {
      const invalid = {
        block_code: 'symptoms',
        values: [1, 2, 3],
      };
      expect(() => checkboxResponseSchema.parse(invalid)).toThrow();
    });
  });

  describe('validateBlockResponse', () => {
    it('validates tags response', () => {
      const response = { block_code: 'tags', values: ['a', 'b'] };
      const result = validateBlockResponse('tags', response) as TagResponse;
      expect(result.values).toEqual(['a', 'b']);
    });

    it('validates feeling_preset response', () => {
      const response = {
        block_code: 'feeling',
        preset_id: 'great',
        computed_values: { energy: 8 },
      };
      const result = validateBlockResponse('feeling_preset', response) as FeelingPresetResponse;
      expect(result.preset_id).toBe('great');
    });

    it('validates scale response', () => {
      const response = { block_code: 'pain', value: 5 };
      const result = validateBlockResponse('scale', response) as ScaleResponse;
      expect(result.value).toBe(5);
    });

    it('validates boolean response', () => {
      const response = { block_code: 'agree', value: true };
      const result = validateBlockResponse('boolean', response);
      expect((result as { value: boolean }).value).toBe(true);
    });

    it('validates text response', () => {
      const response = { block_code: 'notes', value: 'test' };
      const result = validateBlockResponse('text', response);
      expect((result as { value: string }).value).toBe('test');
    });

    it('validates textarea response (same as text)', () => {
      const response = { block_code: 'notes', value: 'test' };
      const result = validateBlockResponse('textarea', response);
      expect((result as { value: string }).value).toBe('test');
    });

    it('validates number response', () => {
      const response = { block_code: 'age', value: 30 };
      const result = validateBlockResponse('number', response);
      expect((result as { value: number }).value).toBe(30);
    });

    it('validates select response', () => {
      const response = { block_code: 'gender', value: 'male' };
      const result = validateBlockResponse('select', response) as SelectResponse;
      expect(result.value).toBe('male');
    });

    it('validates radio response (same as select)', () => {
      const response = { block_code: 'option', value: 'a' };
      const result = validateBlockResponse('radio', response);
      expect((result as SelectResponse).value).toBe('a');
    });

    it('validates checkbox response', () => {
      const response = { block_code: 'symptoms', values: ['a', 'b'] };
      const result = validateBlockResponse('checkbox', response) as CheckboxResponse;
      expect(result.values).toEqual(['a', 'b']);
    });

    it('throws for unknown question type', () => {
      const response = { block_code: 'test', value: 'test' };
      expect(() => validateBlockResponse('unknown_type', response)).toThrow(
        'Unknown question type: unknown_type'
      );
    });

    it('throws for invalid response structure', () => {
      expect(() => validateBlockResponse('scale', { block_code: 'test', value: 'not a number' })).toThrow();
    });
  });

  describe('safeValidateBlockResponse', () => {
    it('returns parsed response on success', () => {
      const response = { block_code: 'pain', value: 5 };
      const result = safeValidateBlockResponse('scale', response);
      expect(result).not.toBeNull();
      expect((result as ScaleResponse).value).toBe(5);
    });

    it('returns null on validation failure', () => {
      const response = { block_code: 'pain', value: 'invalid' };
      const result = safeValidateBlockResponse('scale', response);
      expect(result).toBeNull();
    });

    it('returns null for unknown question type', () => {
      const response = { block_code: 'test' };
      const result = safeValidateBlockResponse('unknown', response);
      expect(result).toBeNull();
    });

    it('returns null for null/undefined input', () => {
      expect(safeValidateBlockResponse('scale', null)).toBeNull();
      expect(safeValidateBlockResponse('scale', undefined)).toBeNull();
    });
  });

  describe('validateTagValues', () => {
    const allowedValues = ['immunity', 'energy', 'sleep', 'stress'];

    it('validates single selected value is allowed', () => {
      const result = validateTagValues(['immunity'], allowedValues, {});
      expect(result.valid).toBe(true);
    });

    it('validates multiple selected values are allowed when multiSelect', () => {
      const result = validateTagValues(['immunity', 'energy'], allowedValues, { multiSelect: true });
      expect(result.valid).toBe(true);
    });

    it('rejects invalid values', () => {
      const result = validateTagValues(['immunity', 'invalid'], allowedValues, {});
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid values');
      expect(result.error).toContain('invalid');
    });

    it('enforces single selection when multiSelect is false', () => {
      const result = validateTagValues(['immunity', 'energy'], allowedValues, {
        multiSelect: false,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('single selection');
    });

    it('allows multiple selection when multiSelect is true', () => {
      const result = validateTagValues(['immunity', 'energy', 'sleep'], allowedValues, {
        multiSelect: true,
      });
      expect(result.valid).toBe(true);
    });

    it('enforces maxSelected constraint', () => {
      const result = validateTagValues(['immunity', 'energy', 'sleep'], allowedValues, {
        multiSelect: true,
        maxSelected: 2,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Maximum 2');
    });

    it('enforces minSelected constraint', () => {
      const result = validateTagValues(['immunity'], allowedValues, {
        multiSelect: true,
        minSelected: 2,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Minimum 2');
    });

    it('allows selection within min-max range', () => {
      const result = validateTagValues(['immunity', 'energy'], allowedValues, {
        multiSelect: true,
        minSelected: 1,
        maxSelected: 3,
      });
      expect(result.valid).toBe(true);
    });

    it('allows empty selection when minSelected is 0 or undefined', () => {
      const result = validateTagValues([], allowedValues, {
        multiSelect: true,
        minSelected: 0,
      });
      expect(result.valid).toBe(true);
    });

    it('handles empty allowed values', () => {
      const result = validateTagValues(['any'], [], {});
      expect(result.valid).toBe(false);
    });
  });
});
