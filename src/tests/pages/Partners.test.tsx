import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Partners from '@/pages/Partners';

const mockUsePartners = vi.fn();

vi.mock('@/components/layout/Header', () => ({
  Header: () => null,
}));

vi.mock('@/components/layout/Footer', () => ({
  Footer: () => null,
}));

vi.mock('@/components/partners/PartnerBookingDialog', () => ({
  PartnerBookingDialog: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

vi.mock('@/hooks/usePartners', () => ({
  usePartners: () => mockUsePartners(),
}));

describe('Partners page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows sign-in banner when partners response is missing (fail-safe anonymous fallback)', () => {
    mockUsePartners.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('rpc fail'),
    });

    render(
      <MemoryRouter>
        <Partners />
      </MemoryRouter>
    );

    expect(screen.getByText('partners.signInForMore.title')).toBeInTheDocument();
    expect(screen.getByText('partners.signInForMore.description')).toBeInTheDocument();
  });

  it('does not show sign-in banner for authenticated response', () => {
    mockUsePartners.mockReturnValue({
      data: {
        partners: [],
        isAuthenticated: true,
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <Partners />
      </MemoryRouter>
    );

    expect(screen.queryByText('partners.signInForMore.title')).not.toBeInTheDocument();
  });
});
