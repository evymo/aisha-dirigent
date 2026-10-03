import { vi } from 'vitest';

// Simple i18n mock that returns the key
export const mockUseTranslation = () => ({
  t: (key: string, params?: Record<string, unknown>) => {
    if (params) {
      // Simple interpolation for common patterns
      let result = key;
      Object.entries(params).forEach(([k, v]) => {
        result = result.replace(`{{${k}}}`, String(v));
      });
      return result;
    }
    return key;
  },
  i18n: {
    language: 'en',
    changeLanguage: vi.fn(),
    exists: vi.fn(() => true),
  },
});

// Mock for react-i18next module
export const createI18nMock = () => ({
  useTranslation: mockUseTranslation,
  Trans: ({ children }: { children: React.ReactNode }) => children,
  I18nextProvider: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
});

export default createI18nMock;
