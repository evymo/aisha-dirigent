import { describe, it, expect } from 'vitest';
import {
  tagOptionSchema,
  tagsConfigSchema,
  feelingPresetValueSchema,
  feelingPresetConfigSchema,
  scaleConfigSchema,
  booleanConfigSchema,
  selectConfigSchema,
  textConfigSchema,
  numberConfigSchema,
  validateBlockConfig,
  safeValidateBlockConfig,
  getDefaultBlockConfig,
  type TagsConfig,
  type FeelingPresetConfig,
  type ScaleConfig,
} from '@/schemas/questionBlockSchemas';

describe('questionBlockSchemas', () => {
  describe('tagOptionSchema', () => {
    it('validates valid tag option', () => {
      const valid = {
        value: 'immunity',
        emoji: '🛡️',
        label_key: 'tags.immunity',
      };
      expect(() => tagOptionSchema.parse(valid)).not.toThrow();
    });

    it('requires value field', () => {
      const invalid = {
        emoji: '🛡️',
      };
      expect(() => tagOptionSchema.parse(invalid)).toThrow();
    });

    it('rejects empty value', () => {
      const invalid = {
        value: '',
        label_key: 'test.label',
      };
      expect(() => tagOptionSchema.parse(invalid)).toThrow();
    });

    it('allows optional fields', () => {
      const minimal = { value: 'test' };
      expect(() => tagOptionSchema.parse(minimal)).not.toThrow();
    });
  });

  describe('tagsConfigSchema', () => {
    it('validates valid tags config', () => {
      const valid = {
        multiSelect: true,
        maxSelected: 3,
        minSelected: 1,
        options: [
          { value: 'a', label_key: 'test.a' },
          { value: 'b', label_key: 'test.b' },
        ],
        layout: 'grid',
        columns: 2,
      };
      const result = tagsConfigSchema.parse(valid);
      expect(result.multiSelect).toBe(true);
      expect(result.maxSelected).toBe(3);
    });

    it('requires at least one option', () => {
      const invalid = {
        options: [],
      };
      expect(() => tagsConfigSchema.parse(invalid)).toThrow();
    });

    it('applies defaults', () => {
      const minimal = {
        options: [{ value: 'test' }],
      };
      const result = tagsConfigSchema.parse(minimal);
      expect(result.multiSelect).toBe(false);
      expect(result.minSelected).toBe(0);
      expect(result.layout).toBe('grid');
      expect(result.columns).toBe(2);
    });

    it('validates layout enum', () => {
      const valid = {
        options: [{ value: 'test' }],
        layout: 'wrap',
      };
      expect(() => tagsConfigSchema.parse(valid)).not.toThrow();

      const invalid = {
        options: [{ value: 'test' }],
        layout: 'invalid',
      };
      expect(() => tagsConfigSchema.parse(invalid)).toThrow();
    });

    it('validates columns range', () => {
      const validMin = {
        options: [{ value: 'test' }],
        columns: 1,
      };
      const validMax = {
        options: [{ value: 'test' }],
        columns: 6,
      };
      const invalid = {
        options: [{ value: 'test' }],
        columns: 7,
      };

      expect(() => tagsConfigSchema.parse(validMin)).not.toThrow();
      expect(() => tagsConfigSchema.parse(validMax)).not.toThrow();
      expect(() => tagsConfigSchema.parse(invalid)).toThrow();
    });
  });

  describe('feelingPresetValueSchema', () => {
    it('validates valid preset', () => {
      const valid = {
        id: 'great',
        emoji: '😊',
        label_key: 'presets.great',
        values: { energy: 8, mood: 8 },
      };
      expect(() => feelingPresetValueSchema.parse(valid)).not.toThrow();
    });

    it('requires id and emoji', () => {
      const missingId = {
        emoji: '😊',
        values: {},
      };
      const missingEmoji = {
        id: 'great',
        values: {},
      };
      expect(() => feelingPresetValueSchema.parse(missingId)).toThrow();
      expect(() => feelingPresetValueSchema.parse(missingEmoji)).toThrow();
    });

    it('allows empty values record', () => {
      const valid = {
        id: 'test',
        emoji: '🎯',
        values: {},
      };
      expect(() => feelingPresetValueSchema.parse(valid)).not.toThrow();
    });
  });

  describe('feelingPresetConfigSchema', () => {
    it('validates valid config', () => {
      const valid = {
        presets: [
          { id: 'great', emoji: '😊', values: { energy: 8 } },
          { id: 'okay', emoji: '🙂', values: { energy: 6 } },
        ],
        showLabels: true,
        showDescriptions: false,
        size: 'lg',
      };
      const result = feelingPresetConfigSchema.parse(valid);
      expect(result.presets).toHaveLength(2);
      expect(result.size).toBe('lg');
    });

    it('requires at least one preset', () => {
      const invalid = {
        presets: [],
      };
      expect(() => feelingPresetConfigSchema.parse(invalid)).toThrow();
    });

    it('applies defaults', () => {
      const minimal = {
        presets: [{ id: 'test', emoji: '🎯', values: {} }],
      };
      const result = feelingPresetConfigSchema.parse(minimal);
      expect(result.showLabels).toBe(true);
      expect(result.showDescriptions).toBe(true);
      expect(result.size).toBe('lg');
    });

    it('validates size enum', () => {
      const validSizes = ['sm', 'md', 'lg'];
      validSizes.forEach((size) => {
        const config = {
          presets: [{ id: 'test', emoji: '🎯', values: {} }],
          size,
        };
        expect(() => feelingPresetConfigSchema.parse(config)).not.toThrow();
      });

      const invalid = {
        presets: [{ id: 'test', emoji: '🎯', values: {} }],
        size: 'xl',
      };
      expect(() => feelingPresetConfigSchema.parse(invalid)).toThrow();
    });
  });

  describe('scaleConfigSchema', () => {
    it('validates valid scale config', () => {
      const valid = {
        min: 0,
        max: 10,
        step: 1,
        showValue: true,
        lowLabel_key: 'questionnaires.blocks.test.lowLabel',
        highLabel_key: 'questionnaires.blocks.test.highLabel',
      };
      const result = scaleConfigSchema.parse(valid);
      expect(result.min).toBe(0);
      expect(result.max).toBe(10);
      expect(result.lowLabel_key).toBe('questionnaires.blocks.test.lowLabel');
    });

    it('applies defaults', () => {
      const empty = {};
      const result = scaleConfigSchema.parse(empty);
      expect(result.min).toBe(0);
      expect(result.max).toBe(10);
      expect(result.step).toBe(1);
      expect(result.showValue).toBe(true);
    });

    it('allows custom range', () => {
      const custom = {
        min: 1,
        max: 5,
        step: 0.5,
      };
      const result = scaleConfigSchema.parse(custom);
      expect(result.min).toBe(1);
      expect(result.max).toBe(5);
      expect(result.step).toBe(0.5);
    });
  });

  describe('booleanConfigSchema', () => {
    it('validates valid boolean config', () => {
      const valid = {
        trueLabel_key: 'questionnaires.common.yes',
        falseLabel_key: 'questionnaires.common.no',
        style: 'buttons',
      };
      const result = booleanConfigSchema.parse(valid);
      expect(result.style).toBe('buttons');
    });

    it('applies defaults', () => {
      const empty = {};
      const result = booleanConfigSchema.parse(empty);
      expect(result.style).toBe('toggle');
    });

    it('validates style enum', () => {
      const validStyles = ['toggle', 'buttons', 'cards'];
      validStyles.forEach((style) => {
        expect(() => booleanConfigSchema.parse({ style })).not.toThrow();
      });

      expect(() => booleanConfigSchema.parse({ style: 'invalid' })).toThrow();
    });
  });

  describe('selectConfigSchema', () => {
    it('validates valid select config', () => {
      const valid = {
        options: [
          { value: 'male', label_key: 'options.male' },
          { value: 'female', label_key: 'options.female' },
        ],
        allowOther: true,
        otherLabel_key: 'form.other',
      };
      const result = selectConfigSchema.parse(valid);
      expect(result.options).toHaveLength(2);
      expect(result.allowOther).toBe(true);
    });

    it('requires at least one option', () => {
      const invalid = { options: [] };
      expect(() => selectConfigSchema.parse(invalid)).toThrow();
    });

    it('applies defaults', () => {
      const minimal = {
        options: [{ value: 'test' }],
      };
      const result = selectConfigSchema.parse(minimal);
      expect(result.allowOther).toBe(false);
    });
  });

  describe('textConfigSchema', () => {
    it('validates valid text config', () => {
      const valid = {
        minLength: 10,
        maxLength: 500,
        placeholder_key: 'form.placeholder.write_here',
        rows: 4,
      };
      const result = textConfigSchema.parse(valid);
      expect(result.maxLength).toBe(500);
      expect(result.rows).toBe(4);
    });

    it('validates rows range', () => {
      expect(() => textConfigSchema.parse({ rows: 0 })).toThrow();
      expect(() => textConfigSchema.parse({ rows: 21 })).toThrow();
      expect(() => textConfigSchema.parse({ rows: 1 })).not.toThrow();
      expect(() => textConfigSchema.parse({ rows: 20 })).not.toThrow();
    });

    it('allows empty config', () => {
      const empty = {};
      expect(() => textConfigSchema.parse(empty)).not.toThrow();
    });
  });

  describe('numberConfigSchema', () => {
    it('validates valid number config', () => {
      const valid = {
        min: 0,
        max: 100,
        step: 5,
        unit_key: 'units.kg',
      };
      const result = numberConfigSchema.parse(valid);
      expect(result.min).toBe(0);
      expect(result.unit_key).toBe('units.kg');
    });

    it('allows all optional fields', () => {
      const empty = {};
      expect(() => numberConfigSchema.parse(empty)).not.toThrow();
    });
  });

  describe('validateBlockConfig', () => {
    it('validates tags config', () => {
      const config = {
        options: [{ value: 'test' }],
      };
      const result = validateBlockConfig('tags', config) as TagsConfig;
      expect(result.options).toHaveLength(1);
    });

    it('validates feeling_preset config', () => {
      const config = {
        presets: [{ id: 'test', emoji: '🎯', values: {} }],
      };
      const result = validateBlockConfig('feeling_preset', config) as FeelingPresetConfig;
      expect(result.presets).toHaveLength(1);
    });

    it('validates scale config', () => {
      const config = { min: 1, max: 5 };
      const result = validateBlockConfig('scale', config) as ScaleConfig;
      expect(result.min).toBe(1);
    });

    it('validates boolean config', () => {
      const config = { style: 'cards' };
      const result = validateBlockConfig('boolean', config);
      expect((result as { style: string }).style).toBe('cards');
    });

    it('validates select/radio/checkbox configs', () => {
      const config = { options: [{ value: 'a' }] };
      expect(() => validateBlockConfig('select', config)).not.toThrow();
      expect(() => validateBlockConfig('radio', config)).not.toThrow();
      expect(() => validateBlockConfig('checkbox', config)).not.toThrow();
    });

    it('validates text/textarea configs', () => {
      const config = { maxLength: 100 };
      expect(() => validateBlockConfig('text', config)).not.toThrow();
      expect(() => validateBlockConfig('textarea', config)).not.toThrow();
    });

    it('validates number config', () => {
      const config = { min: 0, max: 100 };
      expect(() => validateBlockConfig('number', config)).not.toThrow();
    });

    it('returns config as-is for unknown type', () => {
      const config = { custom: 'data' };
      const result = validateBlockConfig('unknown_type', config);
      expect(result).toEqual(config);
    });

    it('throws for invalid config', () => {
      expect(() => validateBlockConfig('tags', { options: [] })).toThrow();
    });
  });

  describe('safeValidateBlockConfig', () => {
    it('returns parsed config on success', () => {
      const config = { options: [{ value: 'test' }] };
      const result = safeValidateBlockConfig('tags', config);
      expect(result).not.toBeNull();
      expect((result as TagsConfig).options).toHaveLength(1);
    });

    it('returns null on validation failure', () => {
      const config = { options: [] }; // Invalid - empty options
      const result = safeValidateBlockConfig('tags', config);
      expect(result).toBeNull();
    });

    it('returns null for invalid config structure', () => {
      const result = safeValidateBlockConfig('tags', 'not an object');
      expect(result).toBeNull();
    });
  });

  describe('getDefaultBlockConfig', () => {
    it('returns default tags config', () => {
      const result = getDefaultBlockConfig('tags') as TagsConfig;
      expect(result.multiSelect).toBe(false);
      expect(result.options).toEqual([]);
      expect(result.layout).toBe('grid');
      expect(result.columns).toBe(2);
    });

    it('returns default feeling_preset config', () => {
      const result = getDefaultBlockConfig('feeling_preset') as FeelingPresetConfig;
      expect(result.presets).toHaveLength(5);
      expect(result.showLabels).toBe(true);
      expect(result.size).toBe('lg');
    });

    it('returns default scale config', () => {
      const result = getDefaultBlockConfig('scale') as ScaleConfig;
      expect(result.min).toBe(0);
      expect(result.max).toBe(10);
      expect(result.step).toBe(1);
    });

    it('returns default boolean config', () => {
      const result = getDefaultBlockConfig('boolean');
      expect((result as { style: string }).style).toBe('toggle');
    });

    it('returns empty object for unknown type', () => {
      const result = getDefaultBlockConfig('unknown');
      expect(result).toEqual({});
    });
  });
});
